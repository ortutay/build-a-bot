import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Account } from '../account/Account.js';
import { createGlobalContext, type GlobalContext } from '../context/index.js';
import { UsesContext, type UsesContextOptions } from '../context/UsesContext.js';
import type { ISerializable } from '../interface/ISerializable.js';
import type { ISaveable } from '../interface/ISaveable.js';
import { availableContext, availableModules } from '../compile/Compiler.js';
import { Run } from '../compile/Run.js';
import { Script } from '../compile/Script.js';
import { log } from '../logger.js';
import { selectAvailableTools } from '../mastra/instruments/availableTools.js';
import { clip, hash } from '../util/index.js';
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

const pageSize = 100;
const maxResults = 1000;
export const defaultListLimit = 100;
const maxAttempts = 2;

export class ScriptNotFoundError extends Error {
  constructor(serviceName: string, sourceUrl: string) {
    super(`No saved script found for service=${serviceName}, source=${sourceUrl}`);
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
    await this.#heal(context);
    const results = await this.#sync(context);
    log.info(
      `Data service sync complete: service=${this.name}, resultCount=${results.results.length}`
    );
  }

  async build(): Promise<void> {
    const context = await this.context();
    return this.#build(context);
  }

  async heal(): Promise<void> {
    const context = await this.context();
    return this.#heal(context);
  }

  async sync(): Promise<DataServiceResult> {
    const context = await this.context();
    return this.#sync(context);
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
    return z
      .object({
        results: z.array(this.itemSchema),
        count: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .superRefine(({ count, results, total }, ctx) => {
        if (count !== results.length) {
          ctx.addIssue({
            code: 'custom',
            message: 'Bot result count must equal the number of returned results',
          });
        }
        if (count > total) {
          ctx.addIssue({ code: 'custom', message: 'Bot result count cannot exceed total' });
        }
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
        .orderBy(itemsTable.uniqueId, itemsTable.dataSourceId)
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

    const inputSchema = z.object({
      limit: z.number().describe('Maximum number of results'),
      offset: z.number().describe('Start gathering results at this offset'),
    });
    const outputSchema = this.#outputSchema();

    for (const source of this.sources) {
      await source.save();
      if (!source.id) {
        throw new Error(`Data source did not receive an ID: ${source.url}`);
      }
    }

    const urls = this.sources.map((source) => source.url);
    const prompt = 'Build a scraper to get data in the output schema format.';
    const scriptName = `urls:${hash({ urls })}`;
    let regenerate = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // TODO:
      // - add Script.findForDataService(context, this.id) and have it return Promise<Script[] | null>
      // - contract: there should either be 0 scripts, or the correct number of scripts
      let script = await Script.findByName(context, this.id!, scriptName);

      try {
        // TODO: check scripts?.length >= 0
        if (!script || regenerate) {
          log.info(`Writing scripts for urls=${urls.join(', ')}`);

          const workflow = context.mastra.getWorkflowById('write-workflow');
          // const workflow = context.mastra.getWorkflowById('plan-workflow');

          const run = await workflow.createRun();
          const tools = Object.entries(selectAvailableTools(context.mastra.listTools() ?? {}))
            .filter(([, tool]) => !('requireApproval' in tool) || !tool.requireApproval)
            .map(([name]) => name);

          const result = await run.start({
            inputData: {
              urls,
              goal: prompt,
              context: Object.keys(availableContext),
              modules: Object.keys(availableModules),
              inputSchema: z.toJSONSchema(inputSchema),
              outputSchema: z.toJSONSchema(outputSchema),
              tools,
            },
          });

          if (result.status !== 'success') {
            throw new Error(`Workflow did not complete successfully: ${result.status}`);
          }

          // TODO:
          // - iterate over each group, and generate a scipt on a per-grouping basis
          // - log out the name of each generated grouping
          // - scriptName should append the groupingName

          const { code, urls: groupingUrls } = result.result as { code: string; urls: string[] };
          script = new Script({
            context,
            id: script?.id ?? undefined,
            name: scriptName,
            dataServiceId: this.id!,
            code,
            buildInput: { goal: prompt, urls: groupingUrls },
            modules: Object.keys(availableModules),
            tools,
            vmContext: Object.keys(availableContext),
          });

          // TODO: don't save here. instead, push scripts onto a list
          await script.save();
          regenerate = false;

          // TODO: per above TODO, move the logging into the loop
          log.info(`Wrote script: id=${script.id}, name=${script.name}`);
        } else {
          // TODO: update logging to give id/name of each script
          log.info(`Found script: id=${script.id}, name=${script.name}`);
        }

        // TODO: Compile them all. error in any means regenerate
        const bot = await script.compile();
        // TODO: update logs
        log.info(`Compiled script: id=${script.id}, name=${script.name}`);
        log.debug(`Made a bot: ${String(bot)}`);
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

    // TODO:
    // in single transaction:
    // - remove previous scripts for this DataService
    // - save them all at once
  }

  async #heal(_context: GlobalContext): Promise<void> {}

  async #sync(context: GlobalContext): Promise<DataServiceResult> {
    await this.save();
    const results: unknown[] = [];

    for (const source of this.sources) {
      await source.save();
      if (!source.id) {
        throw new Error(`Data source did not receive an ID: ${source.url}`);
      }

      const url = source.url;
      const script =
        (await Script.findByBuildUrl(context, this.id!, url)) ??
        (await Script.findByName(context, this.id!, `url:${url}`));
      if (!script) {
        throw new ScriptNotFoundError(this.name, url);
      }

      log.info(`Running script: id=${script.id}, name=${script.name}`);
      const bot = await script.compile();
      const uniqueIds = new Set<string>();

      for (let offset = 0; offset < maxResults; offset += pageSize) {
        const input = { limit: pageSize, offset };
        const run = new Run({ input, scriptId: script.id! });
        await run.save(context.storage);

        try {
          const output = await this.#outputSchema().parseAsync(await bot.run(input));
          const { count, results: botResults, total } = output;
          const pageUniqueIds = new Set<string>();
          const uniqueResults = botResults.flatMap((data) => {
            const uniqueId = bot.uniqueId(data);
            if (pageUniqueIds.has(uniqueId)) {
              return [];
            }

            pageUniqueIds.add(uniqueId);
            uniqueIds.add(uniqueId);
            return [{ data, uniqueId }];
          });
          await run.complete(
            context.storage,
            uniqueResults.map((result) => result.data)
          );
          await Promise.all(
            uniqueResults.map(({ data, uniqueId }) =>
              new Item({
                data,
                dataSourceId: source.id!,
                sourceScriptId: script.id!,
                uniqueId,
              }).save(context.storage)
            )
          );

          results.push(...uniqueResults.map((result) => result.data));
          if (count === 0) {
            log.info(`No results returned for script=${script.name}, source=${url}`);
            break;
          }

          log.info(`Bot run summary: total=${total}, count=${count}, first=${clip(botResults[0])}`);
          if (count < pageSize || offset + count >= total) {
            break;
          }
        } catch (e) {
          await run.fail(context.storage, e);
          throw e;
        }
      }

      const items = await context.storage.db
        .select()
        .from(itemsTable)
        .where(
          and(eq(itemsTable.sourceScriptId, script.id!), eq(itemsTable.dataSourceId, source.id))
        );
      await Promise.all(
        items
          .filter((item) => !uniqueIds.has(item.uniqueId))
          .map((item) => new Item(item).remove(context.storage))
      );
    }

    return { results };
  }
}
