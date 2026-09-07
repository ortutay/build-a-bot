import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Account } from '../../account/Account.js';
import type { GlobalContext } from '../../context/index.js';
import type { ISerializable } from '../../interface/ISerializable.js';
import type { ISaveable } from '../../interface/ISaveable.js';
import { availableContext, availableModules } from '../../internal/compile/Compiler.js';
import { Run } from '../../internal/compile/Run.js';
import { Script } from '../../internal/compile/Script.js';
import { log } from '../../internal/logger.js';
import { selectAvailableTools } from '../../internal/mastra/instruments/availableTools.js';
import { clip } from '../../internal/util/index.js';
import type { StorageTransaction } from '../../storage/Storage.js';
import {
  dataServicesTable,
  dataSourcesTable,
  itemsTable,
  scriptsTable,
  servicesTable,
} from '../../storage/db/schema.js';
import { findById } from '../../storage/helpers.js';
import {
  type ServiceContext,
  type ServiceConfig,
  type ServiceConstructorOptions,
  type ServiceOptions,
  Service,
} from '../Service.js';
import { DataSource, type DataSourceConfig } from './DataSource.js';
import { Item } from './Item.js';

export type DataServiceOptions = ServiceOptions & {
  sources: DataSource[];
  itemSchema: DataServiceItemSchema;
};
type DataServiceConstructorOptions = ServiceConstructorOptions & DataServiceOptions;

export type DataServiceResult = { results: unknown[] };
export type DataServiceListOptions = { limit?: number; page?: number };
export type DataServiceConfig = ServiceConfig & {
  itemSchema: Record<string, unknown>;
  sources: DataSourceConfig[];
  type: 'data';
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
  extends Service<DataServiceResult>
  implements ISerializable<DataServiceConfig>, ISaveable
{
  itemSchema: z.ZodType;
  sources: DataSource[];

  readonly type = 'data';

  #initPromise?: Promise<void>;
  #itemSchemaConfig: Record<string, unknown>;

  constructor(options: DataServiceConstructorOptions) {
    super(options);
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
    const service = await findById(servicesTable, context, id);

    return service?.type === 'data' ? DataService.#fromRow(context, service) : null;
  }

  static async findByName(
    context: GlobalContext,
    accountId: string,
    name: string
  ): Promise<DataService | null> {
    await context.init();
    const [service] = await context.storage.db
      .select()
      .from(servicesTable)
      .where(
        and(
          eq(servicesTable.accountId, accountId),
          eq(servicesTable.name, name),
          eq(servicesTable.type, 'data')
        )
      )
      .limit(1);

    return service ? DataService.#fromRow(context, service) : null;
  }

  async save(tx?: StorageTransaction): Promise<void> {
    await this.#init();
    const context = await this.context();
    const accountId = this.account?.id;
    if (!accountId) {
      throw new Error(`Cannot save data service without a saved account: ${this.name}`);
    }

    await context.storage.fillInTransaction(tx, async (tx) => {
      const [service] = await tx
        .insert(servicesTable)
        .values({
          accountId,
          name: this.name,
          type: this.type,
        })
        .onConflictDoUpdate({
          target: [servicesTable.accountId, servicesTable.name],
          set: { type: this.type },
        })
        .returning();
      if (!service) {
        throw new Error(`Could not save data service: ${this.name}`);
      }

      this.id = service.id;
      await tx
        .insert(dataServicesTable)
        .values({
          itemSchema: this.#schemaConfig(),
          serviceId: service.id,
        })
        .onConflictDoUpdate({
          target: dataServicesTable.serviceId,
          set: { itemSchema: this.#schemaConfig() },
        });

      for (const source of this.sources) {
        source.bindContext(context);
        source.dataServiceId = service.id;
        await source.save(tx);
      }
    });
  }

  async remove(tx?: StorageTransaction): Promise<void> {
    if (!this.id) {
      throw new Error('Cannot remove an unsaved data service');
    }

    const context = await this.context();
    await context.init();
    const id = this.id;
    await context.storage.fillInTransaction(tx, async (tx) => {
      await tx.delete(dataSourcesTable).where(eq(dataSourcesTable.dataServiceId, id));
      await tx.delete(dataServicesTable).where(eq(dataServicesTable.serviceId, id));
      await tx.delete(servicesTable).where(eq(servicesTable.id, id));
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
      type: this.type,
    };
  }

  static load(config: DataServiceConfig, context?: GlobalContext, account?: Account): DataService {
    if (config.type !== 'data') {
      throw new Error(`Cannot load a non-data service: ${config.type}`);
    }

    return new DataService({
      account,
      context,
      itemSchema: config.itemSchema,
      name: config.name,
      sources: config.sources.map((source) => DataSource.load(source, context)),
    });
  }

  static async #fromRow(
    context: GlobalContext,
    service: typeof servicesTable.$inferSelect
  ): Promise<DataService | null> {
    const [dataService] = await context.storage.db
      .select()
      .from(dataServicesTable)
      .where(eq(dataServicesTable.serviceId, service.id))
      .limit(1);
    if (!dataService) {
      return null;
    }

    const account = await Account.findById(context, service.accountId);
    if (!account) {
      throw new Error(`Could not load account for data service: ${service.id}`);
    }

    const sources = await context.storage.db
      .select()
      .from(dataSourcesTable)
      .where(eq(dataSourcesTable.dataServiceId, service.id));

    return new DataService({
      context,
      id: service.id,
      account,
      itemSchema: dataService.itemSchema,
      name: service.name,
      sources: sources.map(
        (source) =>
          new DataSource({
            context,
            ...source,
          })
      ),
    });
  }

  #schemaConfig(): Record<string, unknown> {
    return this.#itemSchemaConfig;
  }

  async #init(): Promise<void> {
    this.#initPromise ??= this.#initOnce();
    return this.#initPromise;
  }

  async #initOnce(): Promise<void> {
    const context = await this.context();
    await context.init();
    if (!this.account) {
      this.account = new Account({ context, username: 'local' });
      await this.account.save();
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
    await context.init();
    const serviceId = this.id;
    if (!serviceId) {
      throw new Error(`Cannot list items for an unsaved data service: ${this.name}`);
    }
    const where = eq(scriptsTable.serviceId, serviceId);
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
    await context.init();
    const serviceId = this.id;
    if (!serviceId) {
      throw new Error(`Cannot get an item for an unsaved data service: ${this.name}`);
    }
    const items = await context.storage.db
      .select({ data: itemsTable.data })
      .from(itemsTable)
      .innerJoin(scriptsTable, eq(itemsTable.sourceScriptId, scriptsTable.id))
      .where(and(eq(scriptsTable.serviceId, serviceId), eq(itemsTable.uniqueId, uniqueId)));
    const [item] = items;

    if (items.length > 1) {
      log.warn(
        `Multiple items found for service=${this.name}, uniqueId=${uniqueId}; returning the first result`
      );
    }

    return item?.data ?? null;
  }

  async _build(context: ServiceContext): Promise<void> {
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
      const url = source.url;
      const prompt = 'Build a scraper to get data in the output schema format.';
      const scriptName = `url:${url}`;
      let regenerate = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let script = await Script.findByName(context, this.id!, scriptName);

        try {
          if (!script || regenerate) {
            log.info(`Writing script: name=${scriptName}, url=${url}`);
            const writeWorkflow = context.mastra.getWorkflowById('write-workflow');
            const run = await writeWorkflow.createRun();
            const tools = Object.entries(selectAvailableTools(context.mastra.listTools() ?? {}))
              .filter(([, tool]) => !('requireApproval' in tool) || !tool.requireApproval)
              .map(([name]) => name);

            const result = await run.start({
              inputData: {
                url,
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

            const { code } = result.result as { code: string };
            script = new Script({
              context,
              id: script?.id ?? undefined,
              name: scriptName,
              serviceId: this.id!,
              code,
              buildInput: { goal: prompt, url },
              modules: Object.keys(availableModules),
              tools,
              vmContext: Object.keys(availableContext),
            });
            await script.save();
            regenerate = false;
            log.info(`Wrote script: id=${script.id}, name=${script.name}`);
          } else {
            log.info(`Found script: id=${script.id}, name=${script.name}`);
          }

          const bot = await script.compile();
          log.info(`Compiled script: id=${script.id}, name=${script.name}`);
          log.debug(`Made a bot: ${String(bot)}`);
          break;
        } catch (e) {
          if (attempt === maxAttempts) {
            throw e;
          }

          regenerate = true;
          log.warn(
            `Build attempt ${attempt} of ${maxAttempts} failed for script=${scriptName}; retrying`
          );
        }
      }
    }
  }

  async _heal(context: ServiceContext): Promise<void> {}

  async _sync(context: ServiceContext): Promise<DataServiceResult> {
    await this.save();
    const results: unknown[] = [];

    for (const source of this.sources) {
      await source.save();
      if (!source.id) {
        throw new Error(`Data source did not receive an ID: ${source.url}`);
      }

      const url = source.url;
      const scriptName = `url:${url}`;
      const script = await Script.findByName(context, this.id!, scriptName);
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
