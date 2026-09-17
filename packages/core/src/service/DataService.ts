import { isDeepStrictEqual } from 'node:util';
import { and, count, desc, eq, notInArray } from 'drizzle-orm';
import PQueue from 'p-queue';
import { z } from 'zod';
import { Account } from '../account/Account.js';
import { cb } from '../cache/busters.js';
import { toolCacheSchema } from '../cache/toolCacheKey.js';
import { createGlobalContext, type GlobalContext } from '../context/index.js';
import { UsesContext, type UsesContextOptions } from '../context/UsesContext.js';
import type { ISaveable } from '../interface/ISaveable.js';
import { availableContext, availableModules } from '../compile/Compiler.js';
import { Run } from '../compile/Run.js';
import { Script } from '../compile/Script.js';
import { log } from '../logger.js';
import { selectAvailableTools } from '../mastra/instruments/availableTools.js';
import { healOutputSchema } from '../mastra/workflows/schemas.js';
import { getOrNull, hash, norm } from '../util/index.js';
import type { StorageTransaction } from '../storage/Storage.js';
import {
  dataServicesTable,
  dataSourcesTable,
  itemsTable,
  scriptsTable,
} from '../storage/db/schema.js';
import { findById } from '../storage/helpers.js';
import { DataSource } from './DataSource.js';
import { Item } from './Item.js';
import { entityId, identitySchema, type IdentityConfig } from './identity.js';

export type DataServiceOptions = UsesContextOptions & {
  id?: string;
  account?: Account;
  name: string;
  sources: DataSource[];
  itemSchema: DataServiceItemSchema;
  identity?: IdentityConfig;
};

export type DataServiceSyncResult = {
  created: Item[];
  updated: { before: Item; after: Item }[];
  outcome: {
    success: { url: string }[];
    unhandled: { url: string }[];
    errors: { url: string; error: string }[];
  };
};
export type DataServiceListOptions = { limit?: number; page?: number };
export type DataServiceItemSchema = z.ZodType | Record<string, unknown>;

export const defaultListLimit = 100;

export class ScriptNotFoundError extends Error {
  constructor(serviceName: string, url: string) {
    super(`No script can handle service=${serviceName}, url=${url}`);
    this.name = 'ScriptNotFoundError';
  }
}

export class DataService extends UsesContext implements ISaveable {
  id: string | null;
  account: Account | null;
  itemSchema: z.ZodType;
  identity: IdentityConfig | null;
  name: string;
  sources: DataSource[];

  #initPromise?: Promise<void>;
  #itemSchemaConfig: Record<string, unknown>;
  #pq = new PQueue({ concurrency: 1 });

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
      this.#itemSchemaConfig = structuredClone(options.itemSchema);
      this.itemSchema = z.fromJSONSchema(options.itemSchema);
    }
    this.identity = options.identity ? identitySchema.parse(options.identity) : null;
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
      identity: dataService.identity ?? undefined,
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
    log.info(`Saving data service id=${this.id}`);
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
          identity: this.identity,
          itemSchema: this.#schemaConfig(),
          name: this.name,
        })
        .onConflictDoUpdate({
          target: [dataServicesTable.accountId, dataServicesTable.name],
          set: { identity: this.identity, itemSchema: this.#schemaConfig() },
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
      const urls = this.sources.map((source) => source.url);
      await tx
        .delete(dataSourcesTable)
        .where(
          and(
            eq(dataSourcesTable.dataServiceId, dataService.id),
            urls.length ? notInArray(dataSourcesTable.url, urls) : undefined
          )
        );
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

  dump() {
    return {
      name: this.name,
      itemSchema: this.#schemaConfig(),
      ...(this.identity ? { identity: this.identity } : {}),
      sources: this.sources.map((source) => source.dump()),
    };
  }

  async start(urls?: string[]): Promise<DataServiceSyncResult> {
    await this.#pq.add(async () => {
      const context = await this.context();
      await this.#build(context);
      await this.#heal(context);
    });
    urls ??= this.sources.map((source) => source.url);
    const changes = await this.sync(urls);
    log.info(
      `Data service sync complete: service=${this.name}, created=${changes.created.length}, updated=${changes.updated.length}`
    );
    return changes;
  }

  async build(): Promise<void> {
    await this.#pq.add(async () => {
      await this.#build(await this.context());
    });
  }

  async heal(): Promise<void> {
    await this.#pq.add(async () => {
      await this.#heal(await this.context());
    });
  }

  async sync(urls: string[]): Promise<DataServiceSyncResult> {
    const valid = new Set<string>();
    const changes: DataServiceSyncResult = {
      created: [],
      updated: [],
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
    const availableTools = Object.entries(selectAvailableTools(context.mastra.listTools() ?? {}))
      .filter(([, tool]) => !('requireApproval' in tool) || !tool.requireApproval)
      .sort(([a], [b]) => a.localeCompare(b));
    const tools = availableTools.map(([name]) => name);
    const fingerprint = hash({
      cacheBuster: cb.dataServiceBuild,
      identity: this.identity,
      goal,
      itemSchema: this.#schemaConfig(),
      tools: availableTools.map(([name, tool]) => ({
        name,
        inputSchema: toolCacheSchema(tool.inputSchema, 'input'),
        outputSchema: toolCacheSchema(tool.outputSchema, 'output'),
      })),
      urls,
    });
    const prefix = `script:${fingerprint}:`;
    const buildInput = { goal, urls };
    const activeScripts = await Script.findActiveForDataService(context, this.id!);
    if (
      activeScripts.length > 0 &&
      activeScripts.every((script) => script.name.startsWith(prefix))
    ) {
      for (const script of activeScripts) {
        log.info(`Found script: id=${script.id}, name=${script.name}`);
      }
      return;
    }

    log.info(`Writing scripts for urls=${urls.join(', ')}`);
    const activeScriptIds = new Set(activeScripts.map((script) => script.id));
    const workflow = context.mastra.getWorkflowById('write-workflow');
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        urls,
        goal,
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
    const scripts = generatedScripts.map(
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
    );

    let activated = false;
    await context.storage.fillInTransaction(undefined, async (tx) => {
      const currentActiveScripts = await tx
        .select({ id: scriptsTable.id, name: scriptsTable.name })
        .from(scriptsTable)
        .where(and(eq(scriptsTable.dataServiceId, this.id!), eq(scriptsTable.active, true)));
      if (
        currentActiveScripts.length > 0 &&
        currentActiveScripts.every((script) => script.name.startsWith(prefix)) &&
        currentActiveScripts.some((script) => !activeScriptIds.has(script.id))
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
      log.info('Skipped script activation because another build completed first');
      return;
    }

    for (const script of scripts) {
      log.info(`Wrote script: id=${script.id}, name=${script.name}`);
    }
  }

  async #heal(context: GlobalContext): Promise<void> {
    const scripts = await Script.findActiveForDataService(context, this.id!);
    log.info(`Healing ${scripts.length} scripts`);
    await Promise.allSettled(scripts.map((script) => this.#healScript(context, script)));
  }

  async #healScript(context: GlobalContext, script: Script): Promise<void> {
    log.info(`Healing script: id=${script.id}, name=${script.name}`);

    const urls = this.sources.map((it) => it.url);
    const workflow = context.mastra.getWorkflowById('heal-workflow');
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        urls,
        goal: 'Convert items into the item schema',
        code: script.code,
        itemSchema: this.#schemaConfig(),
        modules: script.modules,
        context: script.vmContext,
        tools: script.tools,
      },
    });

    if (result.status !== 'success') {
      throw new Error(`Workflow did not complete successfully: ${result.status}`);
    }
    const val = healOutputSchema.parse(result.result);
    if (!val.shouldSave) {
      log.info(`Heal made no changes to script: id=${script.id}, name=${script.name}`);
      return;
    }

    script.code = val.code ?? script.code;
    script.modules = val.modules;
    script.tools = val.tools;
    script.vmContext = val.context;
    await script.save();
    log.info(`Healed script: id=${script.id}, name=${script.name}`);
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
        for (const { item } of rows) {
          const key = this.identity ? entityId(item.data, this.identity) : item.uniqueId;
          if (!previous.has(key)) {
            previous.set(key, new Item(item));
          }
        }
        const dataById = new Map<string, unknown>();
        const uniqueResults = items.flatMap((data) => {
          const uniqueId = this.identity ? entityId(data, this.identity) : bot.uniqueId(data);
          // Compare persisted JSON, including values created in the script VM.
          const normalized = JSON.parse(JSON.stringify(data)) as unknown;
          if (dataById.has(uniqueId)) {
            if (!isDeepStrictEqual(dataById.get(uniqueId), normalized)) {
              log.warn(
                `Conflicting records share identity ${uniqueId} for source=${url}, service=${this.name}; keeping the first item`
              );
            }
            return [];
          }
          dataById.set(uniqueId, normalized);
          return [{ data: normalized, uniqueId }];
        });

        const pending: Pick<DataServiceSyncResult, 'created' | 'updated'> = {
          created: [],
          updated: [],
        };

        const lastSeenAt = new Date().toISOString();
        await context.storage.fillInTransaction(undefined, async (tx) => {
          for (const { data, uniqueId } of uniqueResults) {
            const before = previous.get(uniqueId);
            const after = new Item({
              id: before?.id ?? undefined,
              lastSeenAt,
              data,
              sourceUrl: url,
              sourceScriptId: script.id!,
              uniqueId: before?.uniqueId ?? uniqueId,
            });
            const unchanged = before && after.compareTo(before);
            if (unchanged) {
              after.sourceScriptId = before.sourceScriptId;
            }
            await after.save(context.storage, tx);
            if (unchanged) {
              continue;
            }
            if (before) {
              pending.updated.push({ before, after });
            } else {
              pending.created.push(after);
            }
          }

          await run.complete(context.storage, tx);
        });
        changes.created.push(...pending.created);
        changes.updated.push(...pending.updated);
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
