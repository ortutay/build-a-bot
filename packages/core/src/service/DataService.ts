import { and, count, eq } from 'drizzle-orm';
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
import { log } from '../logger.js';
import { selectAvailableTools } from '../mastra/instruments/availableTools.js';
import { hash, norm } from '../util/index.js';
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

export type DataServiceResult = { results: unknown[] };
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
    const results = await this.#sync(context, norm(this.sources.map((source) => source.url)));
    log.info(
      `Data service sync complete: service=${this.name}, resultCount=${results.results.length}`
    );
  }

  async build(): Promise<void> {
    const context = await this.context();
    return this.#build(context);
  }

  async sync(urls: string[]): Promise<DataServiceResult> {
    const context = await this.context();
    return this.#sync(context, norm(urls));
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

  #outputSchema() {
    return z.object({
      results: z.array(this.itemSchema),
      urlsVisited: z.array(z.string()),
    });
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
    }).slice(0, 10);
    const prefix = `script:${fingerprint}:`;
    const buildInput = { goal, urls };
    let regenerate = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
              urls,
              goal,
              context: Object.keys(availableContext),
              modules: Object.keys(availableModules),
              outputSchema: this.#schemaConfig(),
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
          scripts = generatedScripts.map(
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
          await Promise.all(scripts.map((script) => script.compile()));
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
        if (attempt === maxAttempts) {
          throw e;
        }

        regenerate = true;
        log.warn(
          `Build attempt ${attempt} of ${maxAttempts} failed for urls=${urls.join(', ')}; retrying`
        );
      }
    }
  }

  async #sync(context: GlobalContext, urls: string[]): Promise<DataServiceResult> {
    await this.save();
    const results: unknown[] = [];
    const scripts = await Script.findActiveForDataService(context, this.id!);
    if (scripts.length === 0) {
      throw new ScriptNotFoundError(this.name, urls.join(', '));
    }
    const bots = await Promise.all(
      scripts.map(async (script) => ({ bot: await script.compile(), script }))
    );
    const checks = await Promise.all(bots.map(({ bot }) => bot.check(urls)));
    for (const check of checks) {
      if (check.length !== urls.length) {
        throw new Error('Bot check must return one boolean for every input URL');
      }
    }

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;
      const matchingBots = bots.filter((_, botIndex) => checks[botIndex]![i]);
      if (matchingBots.length === 0) {
        throw new ScriptNotFoundError(this.name, url);
      }
      if (matchingBots.length > 1) {
        throw new Error(`Multiple scripts can handle url=${url} for service=${this.name}`);
      }

      const { bot, script } = matchingBots[0]!;

      log.info(`Running script: id=${script.id}, name=${script.name}`);
      const uniqueIds = new Set<string>();
      const run = new Run({ input: { urls: [url] }, scriptId: script.id! });
      await run.save(context.storage);

      try {
        const output = await this.#outputSchema().parseAsync(await bot.run([url], run.id!));
        const uniqueResults = output.results.flatMap((data) => {
          const uniqueId = bot.uniqueId(data);
          if (uniqueIds.has(uniqueId)) {
            return [];
          }

          uniqueIds.add(uniqueId);
          return [{ data, uniqueId }];
        });
        await run.complete(
          context.storage,
          uniqueResults.map((result) => result.data)
        );
        log.info(`Saving ${uniqueResults.length} items: script=${script.name}, sourceUrl=${url}`);
        await Promise.all(
          uniqueResults.map(({ data, uniqueId }) =>
            new Item({
              data,
              sourceUrl: url,
              sourceScriptId: script.id!,
              uniqueId,
            }).save(context.storage)
          )
        );

        results.push(...uniqueResults.map((result) => result.data));
      } catch (e) {
        await run.fail(context.storage, e);
        throw e;
      }

      const items = await context.storage.db
        .select()
        .from(itemsTable)
        .where(and(eq(itemsTable.sourceScriptId, script.id!), eq(itemsTable.sourceUrl, url)));
      const staleItems = items.filter((item) => !uniqueIds.has(item.uniqueId));
      log.info(
        `Removing ${staleItems.length} stale items: script=${script.name}, sourceUrl=${url}`
      );
      await Promise.all(staleItems.map((item) => new Item(item).remove(context.storage)));
    }

    return { results };
  }
}
