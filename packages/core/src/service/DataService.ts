import { isDeepStrictEqual } from 'node:util';
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Account } from '../account/Account.js';
import { cb } from '../cache/busters.js';
import { createGlobalContext, type GlobalContext } from '../context/index.js';
import { UsesContext, type UsesContextOptions } from '../context/UsesContext.js';
import type { ISerializable } from '../interface/ISerializable.js';
import type { ISaveable } from '../interface/ISaveable.js';
import { availableContext, availableModules } from '../compile/Compiler.js';
import { Run } from '../compile/Run.js';
import { Script } from '../compile/Script.js';
import { SeedValidationError, validateScripts } from '../compile/validateScripts.js';
import { log } from '../logger.js';
import { selectAvailableTools } from '../mastra/instruments/availableTools.js';
import { getOrNull, hash, norm } from '../util/index.js';
import type { StorageTransaction } from '../storage/Storage.js';
import {
  dataServicesTable,
  dataSourcesTable,
  itemsTable,
  scriptsTable,
} from '../storage/db/schema.js';
import { findById } from '../storage/helpers.js';
import { DataSource, type DataSourceConfig } from './DataSource.js';
import { Item } from './Item.js';

export type DataServiceOptions = UsesContextOptions & {
  id?: string;
  account?: Account;
  name: string;
  sources: DataSource[];
  itemSchema: DataServiceItemSchema;
};

export type DataServiceSyncResult = {
  created: Item[];
  updated: { before: Item; after: Item }[];
  removed: Item[];
  outcome: {
    success: { url: string }[];
    unhandled: { url: string }[];
    errors: { url: string; error: string }[];
  };
};
export type DataServiceListOptions = { limit?: number; page?: number };
export type DataServiceConfig = {
  itemSchema: Record<string, unknown>;
  name: string;
  sources: DataSourceConfig[];
};

export type DataServiceItemSchema = z.ZodType | Record<string, unknown>;

export const defaultListLimit = 100;
const maxAttempts = 2;

export class ScriptNotFoundError extends Error {
  constructor(serviceName: string, url: string) {
    super(`No script can handle service=${serviceName}, url=${url}`);
    this.name = 'ScriptNotFoundError';
  }
}

export class DataService
  extends UsesContext
  implements ISerializable<DataServiceConfig>, ISaveable
{
  id: string | null;
  account: Account | null;
  itemSchema: z.ZodType;
  name: string;
  sources: DataSource[];

  #initPromise?: Promise<void>;
  #itemSchemaConfig: Record<string, unknown>;

  constructor(options: DataServiceOptions) {
    super(options);
    this.account = options.account ?? null;
    this.id = options.id ?? null;
    this.name = options.name;
    this.sources = options.sources;
    if (options.itemSchema instanceof z.ZodType) {
      this.#itemSchemaConfig = z.toJSONSchema(options.itemSchema) as Record<string, unknown>;
      this.itemSchema = options.itemSchema;
    } else {
      this.#itemSchemaConfig = options.itemSchema;
      this.itemSchema = z.fromJSONSchema(options.itemSchema);
    }
  }

  static async findById(context: GlobalContext, id: string): Promise<DataService | null> {
    const dataService = await findById(dataServicesTable, context, id);

    return dataService ? DataService.#fromRow(context, dataService) : null;
  }

  static async findByName(
    context: GlobalContext,
    accountId: string,
    name: string
  ): Promise<DataService | null> {
    await context.init();
    const [dataService] = await context.storage.db
      .select()
      .from(dataServicesTable)
      .where(and(eq(dataServicesTable.accountId, accountId), eq(dataServicesTable.name, name)))
      .limit(1);

    return dataService ? DataService.#fromRow(context, dataService) : null;
  }

  static load(config: DataServiceConfig, context?: GlobalContext, account?: Account): DataService {
    return new DataService({
      account,
      context,
      itemSchema: config.itemSchema,
      name: config.name,
      sources: config.sources.map((source) => DataSource.load(source, context)),
    });
  }

  static async sharedContext(services: readonly DataService[]): Promise<GlobalContext> {
    let context: GlobalContext | undefined;
    for (const service of services) {
      const candidate = service.boundContext();
      if (candidate && context && candidate !== context) {
        throw new Error('Data services must use the same context');
      }

      context ??= candidate;
    }

    context ??= await createGlobalContext();
    for (const service of services) {
      const candidate = service.boundContext();
      if (candidate && candidate !== context) {
        throw new Error('Data services must use the same context');
      }
      if (!candidate) {
        service.bindContext(context);
      }
    }

    return context;
  }

  static async #fromRow(
    context: GlobalContext,
    dataService: typeof dataServicesTable.$inferSelect
  ): Promise<DataService | null> {
    const account = await Account.findById(context, dataService.accountId);
    if (!account) {
      throw new Error(`Could not load account for data service: ${dataService.id}`);
    }

    const sources = await context.storage.db
      .select()
      .from(dataSourcesTable)
      .where(eq(dataSourcesTable.dataServiceId, dataService.id));

    return new DataService({
      context,
      id: dataService.id,
      account,
      itemSchema: dataService.itemSchema,
      name: dataService.name,
      sources: sources.map(
        (source) =>
          new DataSource({
            context,
            ...source,
          })
      ),
    });
  }

  async save(tx?: StorageTransaction): Promise<void> {
    const context = await this.context();

    await context.storage.fillInTransaction(tx, async (tx) => {
      await this.#init(context, tx);
      const accountId = this.account?.id;
      if (!accountId) {
        throw new Error(`Cannot save data service without a saved account: ${this.name}`);
      }

      const [dataService] = await tx
        .insert(dataServicesTable)
        .values({
          accountId,
          itemSchema: this.#schemaConfig(),
          name: this.name,
        })
        .onConflictDoUpdate({
          target: [dataServicesTable.accountId, dataServicesTable.name],
          set: { itemSchema: this.#schemaConfig() },
        })
        .returning();
      if (!dataService) {
        throw new Error(`Could not save data service: ${this.name}`);
      }

      this.id = dataService.id;

      for (const source of this.sources) {
        source.bindContext(context);
        source.dataServiceId = dataService.id;
        await source.save(tx);
      }
    });
  }

  async remove(tx?: StorageTransaction): Promise<void> {
    if (!this.id) {
      throw new Error('Cannot remove an unsaved data service');
    }

    const context = await this.context();
    const id = this.id;
    await context.storage.fillInTransaction(tx, async (tx) => {
      await tx.delete(dataSourcesTable).where(eq(dataSourcesTable.dataServiceId, id));
      await tx.delete(dataServicesTable).where(eq(dataServicesTable.id, id));
      this.id = null;
      for (const source of this.sources) {
        source.dataServiceId = null;
        source.id = null;
      }
    });
  }

  dump(): DataServiceConfig {
    return {
      itemSchema: this.#schemaConfig(),
      name: this.name,
      sources: this.sources.map((source) => source.dump()),
    };
  }

  async start(): Promise<void> {
    const context = await this.context();
    await this.#build(context);
    const changes = await this.sync(this.sources.map((source) => source.url));
    log.info(
      `Data service sync complete: service=${this.name}, created=${changes.created.length}, updated=${changes.updated.length}, removed=${changes.removed.length}`
    );
  }

  async build(): Promise<void> {
    const context = await this.context();
    return this.#build(context);
  }

  async sync(urls: string[]): Promise<DataServiceSyncResult> {
    const valid = new Set<string>();
    const changes: DataServiceSyncResult = {
      created: [],
      updated: [],
      removed: [],
      outcome: { success: [], unhandled: [], errors: [] },
    };
    for (const url of new Set(urls)) {
      try {
        valid.add(norm(url));
      } catch (e) {
        log.warn(`Could not normalize sync URL ${url}: ${String(e)}`);
        changes.outcome.unhandled.push({ url });
      }
    }
    if (valid.size) {
      await this.#sync(await this.context(), [...valid].sort(), changes);
    }
    return changes;
  }

  #schemaConfig(): Record<string, unknown> {
    return this.#itemSchemaConfig;
  }

  async #init(context: GlobalContext, tx: StorageTransaction): Promise<void> {
    this.#initPromise ??= this.#initOnce(context, tx);
    return this.#initPromise;
  }

  async #initOnce(context: GlobalContext, tx: StorageTransaction): Promise<void> {
    if (!this.account) {
      this.account = await Account.local(context, tx);
    }
  }

  async list({ limit = defaultListLimit, page = 1 }: DataServiceListOptions = {}) {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new Error('DataService list page must be a positive integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('DataService list limit must be a positive integer');
    }

    const context = await this.context();
    const dataServiceId = this.id;
    if (!dataServiceId) {
      throw new Error(`Cannot list items for an unsaved data service: ${this.name}`);
    }
    const where = eq(scriptsTable.dataServiceId, dataServiceId);
    const [totalResults, items] = await Promise.all([
      context.storage.db
        .select({ total: count() })
        .from(itemsTable)
        .innerJoin(scriptsTable, eq(itemsTable.sourceScriptId, scriptsTable.id))
        .where(where),
      context.storage.db
        .select({ data: itemsTable.data, uniqueId: itemsTable.uniqueId })
        .from(itemsTable)
        .innerJoin(scriptsTable, eq(itemsTable.sourceScriptId, scriptsTable.id))
        .where(where)
        .orderBy(itemsTable.uniqueId, itemsTable.sourceUrl)
        .limit(limit)
        .offset((page - 1) * limit),
    ]);
    const [totalResult] = totalResults;
    const results = items.map((item) => {
      const { id: _id, ...data } = item.data as Record<string, unknown>;
      return { id: item.uniqueId, ...data };
    });

    return { count: results.length, total: totalResult?.total ?? 0, results };
  }

  async detail(uniqueId: string): Promise<unknown | null> {
    const context = await this.context();
    const dataServiceId = this.id;
    if (!dataServiceId) {
      throw new Error(`Cannot get an item for an unsaved data service: ${this.name}`);
    }
    const items = await context.storage.db
      .select({ data: itemsTable.data })
      .from(itemsTable)
      .innerJoin(scriptsTable, eq(itemsTable.sourceScriptId, scriptsTable.id))
      .where(and(eq(scriptsTable.dataServiceId, dataServiceId), eq(itemsTable.uniqueId, uniqueId)));
    const [item] = items;

    if (items.length > 1) {
      log.warn(
        `Multiple items found for service=${this.name}, uniqueId=${uniqueId}; returning the first result`
      );
    }

    return item?.data ?? null;
  }

  async #build(context: GlobalContext): Promise<void> {
    await this.save();
    log.info(`Build data service: ${JSON.stringify(this.itemSchema)}`);

    for (const source of this.sources) {
      await source.save();
      if (!source.id) {
        throw new Error(`Data source did not receive an ID: ${source.url}`);
      }
    }

    const urls = norm(this.sources.map((source) => source.url));
    const goal = 'Build a scraper to get data in the output schema format.';
    const fingerprint = hash({
      cacheBuster: cb.dataServiceBuild,
      goal,
      itemSchema: this.#schemaConfig(),
      urls,
    });
    const prefix = `script:${fingerprint}:`;
    const buildInput = { goal, urls };
    let regenerate = false;
    let repair = '';
    let repairUrls = urls;
    let retained: Script[] = [];
    let candidates: Script[] = [];
    const failures = new Map<string, number>();
    for (let attempt = 1; attempt <= maxAttempts * (urls.length + 1); attempt++) {
      let scripts = await Script.findActiveForDataService(context, this.id!);

      try {
        if (
          scripts.length === 0 ||
          !scripts.every((script) => script.name.startsWith(prefix)) ||
          regenerate
        ) {
          log.info(`Writing scripts for urls=${urls.join(', ')}`);
          const activeScriptIds = new Set(scripts.map((script) => script.id));

          const workflow = context.mastra.getWorkflowById('write-workflow');
          const run = await workflow.createRun();
          const tools = Object.entries(selectAvailableTools(context.mastra.listTools() ?? {}))
            .filter(([, tool]) => !('requireApproval' in tool) || !tool.requireApproval)
            .map(([name]) => name);

          const result = await run.start({
            inputData: {
              urls: repairUrls,
              goal: repair ? `${goal}\nRepair the previous candidate. ${repair}` : goal,
              context: Object.keys(availableContext),
              modules: Object.keys(availableModules),
              itemSchema: this.#schemaConfig(),
              tools,
            },
          });

          if (result.status !== 'success') {
            throw new Error(`Workflow did not complete successfully: ${result.status}`);
          }

          const generatedScripts = result.result as Array<{ code: string; groupingName: string }>;
          if (generatedScripts.length === 0) {
            throw new Error('Workflow generated no scripts');
          }
          scripts = [
            ...retained,
            ...generatedScripts.map(
              ({ code }) =>
                new Script({
                  context,
                  name: `${prefix}${hash({ code }).slice(0, 10)}`,
                  dataServiceId: this.id!,
                  code,
                  buildInput,
                  modules: Object.keys(availableModules),
                  tools,
                  vmContext: Object.keys(availableContext),
                })
            ),
          ];
          candidates = scripts;
          await validateScripts(scripts, urls, this.itemSchema, (e) => {
            if (!failures.has(e.url)) {
              return false;
            }
            log.warn(`Activating best-effort candidate; sync will report failures: ${e.message}`);
            return true;
          });
          let activated = false;
          await context.storage.fillInTransaction(undefined, async (tx) => {
            const activeScripts = await tx
              .select({ id: scriptsTable.id, name: scriptsTable.name })
              .from(scriptsTable)
              .where(and(eq(scriptsTable.dataServiceId, this.id!), eq(scriptsTable.active, true)));
            if (
              activeScripts.length > 0 &&
              activeScripts.every((script) => script.name.startsWith(prefix)) &&
              activeScripts.some((script) => !activeScriptIds.has(script.id))
            ) {
              return;
            }
            await tx
              .update(scriptsTable)
              .set({ active: false })
              .where(and(eq(scriptsTable.dataServiceId, this.id!), eq(scriptsTable.active, true)));
            for (const script of scripts) {
              await script.save(tx);
            }
            activated = true;
          });
          if (!activated) {
            regenerate = false;
            scripts = await Script.findActiveForDataService(context, this.id!);
            await Promise.all(scripts.map((script) => script.compile()));
            for (const script of scripts) {
              log.info(`Found script: id=${script.id}, name=${script.name}`);
            }
          } else {
            for (const script of scripts) {
              log.info(`Wrote script: id=${script.id}, name=${script.name}`);
            }
          }
          regenerate = false;
        } else {
          for (const script of scripts) {
            log.info(`Found script: id=${script.id}, name=${script.name}`);
          }
          await Promise.all(scripts.map((script) => script.compile()));
        }

        for (const script of scripts) {
          log.info(`Compiled script: id=${script.id}, name=${script.name}`);
        }
        break;
      } catch (e) {
        const key = e instanceof SeedValidationError ? e.url : 'build';
        const failed = (failures.get(key) ?? 0) + 1;
        failures.set(key, failed);
        if (failed >= maxAttempts) {
          throw e;
        }
        retained =
          e instanceof SeedValidationError
            ? candidates.filter((script) => script !== e.script)
            : [];
        repairUrls = e instanceof SeedValidationError ? e.urls : urls;
        regenerate = true;
        repair = `Attempt ${attempt} failed: ${String(e)}. Use only exposed tool names. Validate the supplied URLs and acquire runtime content using the same fetch/browser mode as your evidence.`;
        if (e instanceof SeedValidationError) {
          repair += `\nKeep the supported URL patterns. Diagnose and correct this failed candidate:\n${e.script.code}`;
        }
        log.warn(
          `Build attempt ${attempt} failed; repairing urls=${repairUrls.join(', ')}; retaining ${retained.length} candidate scripts`
        );
      }
    }
  }

  async #sync(
    context: GlobalContext,
    urls: string[],
    changes: DataServiceSyncResult
  ): Promise<void> {
    await this.save();
    const scripts = await Script.findActiveForDataService(context, this.id!);
    const checked = await Promise.all(
      scripts.map(async (script) => {
        try {
          const bot = await script.compile();
          const check = await Promise.all(
            urls.map(async (url) => {
              try {
                return await bot.check(url);
              } catch (e) {
                log.warn(`Script ${script.id} check failed for ${url}: ${String(e)}`);
                return false;
              }
            })
          );
          return { bot, script, check };
        } catch (e) {
          log.warn(`Could not compile script ${script.id} (${script.name}): ${String(e)}`);
          return null;
        }
      })
    );
    const routes = urls.flatMap((url, i) => {
      const matches = checked.filter((val) => val !== null && val.check[i]);
      if (matches.length !== 1) {
        if (matches.length > 1) {
          log.warn(`Multiple scripts can handle url=${url}; leaving it unhandled`);
        }
        changes.outcome.unhandled.push({ url });
        return [];
      }
      const { bot, script } = matches[0]!;
      return [{ url, bot, script, run: new Run({ input: { url }, scriptId: script.id! }) }];
    });

    // Keep database writes sequential; extraction for independent URLs runs concurrently.
    const ready = [] as typeof routes;
    for (const route of routes) {
      try {
        await route.run.save(context.storage);
        ready.push(route);
      } catch (e) {
        changes.outcome.errors.push({ url: route.url, error: String(e) });
      }
    }
    const outputs = await Promise.allSettled(
      ready.map(({ bot, url, run }) => bot.run(url, run.id!))
    );
    for (const [i, { url, bot, script, run }] of ready.entries()) {
      try {
        const output = outputs[i]!;
        if (output.status === 'rejected') {
          throw output.reason;
        }
        const items = await z.array(this.itemSchema).parseAsync(output.value);
        const rows = await context.storage.db
          .select({ item: itemsTable })
          .from(itemsTable)
          .innerJoin(scriptsTable, eq(itemsTable.sourceScriptId, scriptsTable.id))
          .where(and(eq(scriptsTable.dataServiceId, this.id!), eq(itemsTable.sourceUrl, url)))
          .orderBy(desc(itemsTable.updatedAt), desc(itemsTable.id));
        const previous = new Map<string, Item>();
        const duplicates: Item[] = [];
        for (const { item } of rows) {
          if (previous.has(item.uniqueId)) {
            duplicates.push(new Item(item));
          } else {
            previous.set(item.uniqueId, new Item(item));
          }
        }
        const uniqueIds = new Set<string>();
        const uniqueResults = items.flatMap((data) => {
          const uniqueId = bot.uniqueId(data);
          if (uniqueIds.has(uniqueId)) {
            return [];
          }
          uniqueIds.add(uniqueId);
          // Compare the persisted JSON representation, including values created in the script VM.
          return [{ data: JSON.parse(JSON.stringify(data)) as unknown, uniqueId }];
        });

        const pending: Pick<DataServiceSyncResult, 'created' | 'updated' | 'removed'> = {
          created: [],
          updated: [],
          removed: [...previous.values()].filter((item) => !uniqueIds.has(item.uniqueId)),
        };

        await context.storage.fillInTransaction(undefined, async (tx) => {
          // Older script versions may have stored the same source item more than once.
          for (const item of duplicates) {
            await tx.delete(itemsTable).where(eq(itemsTable.id, item.id!));
          }
          for (const { data, uniqueId } of uniqueResults) {
            const before = previous.get(uniqueId);
            if (before && isDeepStrictEqual(before.data, data)) {
              continue;
            }
            const after = new Item({
              id: before?.id ?? undefined,
              data,
              sourceUrl: url,
              sourceScriptId: script.id!,
              uniqueId,
            });
            await after.save(context.storage, tx);
            if (before) {
              pending.updated.push({ before, after });
            } else {
              pending.created.push(after);
            }
          }

          for (const item of pending.removed) {
            // Keep the returned pre-removal item intact, including its stored ID.
            await tx.delete(itemsTable).where(eq(itemsTable.id, item.id!));
          }

          await run.complete(
            context.storage,
            uniqueResults.map((val) => val.data),
            tx
          );
        });
        changes.created.push(...pending.created);
        changes.updated.push(...pending.updated);
        changes.removed.push(...pending.removed);
        changes.outcome.success.push({ url });
      } catch (e) {
        const message = getOrNull<unknown>(e, 'message');
        changes.outcome.errors.push({
          url,
          error: typeof message === 'string' ? message : String(e),
        });
        if (run.id) {
          try {
            await run.fail(context.storage, e);
          } catch (e) {
            log.warn(`Could not persist failed sync run for ${url}: ${String(e)}`);
          }
        }
      }
    }
  }
}
