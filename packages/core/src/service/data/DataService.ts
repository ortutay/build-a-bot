import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { availableContext, availableModules } from '../../internal/compile/Compiler.js';
import { Run } from '../../internal/compile/Run.js';
import { Script } from '../../internal/compile/Script.js';
import { log } from '../../internal/logger.js';
import { selectAvailableTools } from '../../internal/mastra/instruments/availableTools.js';
import { clip } from '../../internal/util/index.js';
import {
  type OpenApiDocument,
  type ServiceContext,
  type ServiceOptions,
  type ServiceConstructorOptions,
  Service,
} from '../Service.js';
import { itemsTable, scriptsTable, servicesTable } from '../../storage/db/schema.js';
import { DataSource } from './DataSource.js';
import { Item } from './Item.js';

export type DataServiceOptions = ServiceOptions & {
  sources: DataSource[];
  itemSchema: z.ZodType;
  // TODO: optional hint?
};

type DataServiceConstructorOptions = ServiceConstructorOptions & DataServiceOptions;

export type DataServiceResult = { results: unknown[] };

const pageSize = 100;
const maxResults = 1000;
const apiDefaultLimit = 100;
const maxAttempts = 2;

const parsePositiveInteger = (val: unknown, defaultVal: number): number | null => {
  if (val === undefined) {
    return defaultVal;
  }

  const parsed = Number(val);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export class ScriptNotFoundError extends Error {
  constructor(serviceName: string, sourceUrl: string) {
    super(`No saved script found for service=${serviceName}, source=${sourceUrl}`);
    this.name = 'ScriptNotFoundError';
  }
}

export class DataService extends Service<DataServiceResult> {
  itemSchema: z.ZodType;
  sources: DataSource[];

  constructor(options: DataServiceConstructorOptions) {
    super(options);
    this.sources = options.sources;
    this.itemSchema = options.itemSchema;
  }

  openApi(): OpenApiDocument {
    const itemSchema = z.toJSONSchema(this.itemSchema);

    return {
      openapi: '3.1.0',
      info: { title: `${this.name} API`, version: '1.0.0' },
      paths: {
        [`/${this.name}/health`]: {
          get: {
            responses: {
              200: {
                description: 'Service is healthy',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { status: { const: 'ok' } },
                      required: ['status'],
                    },
                  },
                },
              },
            },
          },
        },
        [`/${this.name}/items`]: {
          get: {
            parameters: [
              {
                name: 'page',
                in: 'query',
                schema: { type: 'integer', minimum: 1, default: 1 },
              },
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', minimum: 1, default: apiDefaultLimit },
              },
            ],
            responses: {
              200: {
                description: 'Current items',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        results: { type: 'array', items: itemSchema },
                        count: { type: 'integer', minimum: 0 },
                        total: { type: 'integer', minimum: 0 },
                      },
                      required: ['results', 'count', 'total'],
                    },
                  },
                },
              },
              400: { description: 'Invalid page or limit' },
            },
          },
        },
        [`/${this.name}/items/{id}`]: {
          get: {
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                description: 'The item unique ID',
                schema: { type: 'string' },
              },
            ],
            responses: {
              200: {
                description: 'Current item',
                content: { 'application/json': { schema: itemSchema } },
              },
              404: { description: 'Item not found' },
            },
          },
        },
      },
    };
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

  async _build(context: ServiceContext): Promise<void> {
    log.info(`Build data service: ${JSON.stringify(this.itemSchema)}`);

    const inputSchema = z.object({
      limit: z.number().describe('Maximum number of results'),
      offset: z.number().describe('Start gathering results at this offset'),
    });
    const outputSchema = this.#outputSchema();

    for (const source of this.sources) {
      await source.save(context.storage);
      if (!source.id) {
        throw new Error(`Data source did not receive an ID: ${source.url}`);
      }
      const url = source.url;
      const prompt = 'Build a scraper to get data in the output schema format.';
      const scriptName = `url:${url}`;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let script = await Script.findByName(context.storage, this.name, scriptName);

        try {
          if (!script) {
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
              name: scriptName,
              code,
              buildInput: { goal: prompt, url },
              context: Object.keys(availableContext),
              modules: Object.keys(availableModules),
              tools,
            });
            await script.save(context.storage, this.name);
            log.info(`Wrote script: id=${script.id}, name=${script.name}`);
          } else {
            log.info(`Found script: id=${script.id}, name=${script.name}`);
          }

          const bot = await script.compile(context.mastra);
          log.info(`Compiled script: id=${script.id}, name=${script.name}`);
          log.debug(`Made a bot: ${String(bot)}`);
          break;
        } catch (e) {
          if (attempt === maxAttempts) {
            throw e;
          }

          if (script) {
            await script.remove(context.storage);
          }
          log.warn(
            `Build attempt ${attempt} of ${maxAttempts} failed for script=${scriptName}; retrying`
          );
        }
      }
    }
  }

  async _heal(context: ServiceContext): Promise<void> {}

  async _sync(context: ServiceContext): Promise<DataServiceResult> {
    const results: unknown[] = [];

    for (const source of this.sources) {
      await source.save(context.storage);
      if (!source.id) {
        throw new Error(`Data source did not receive an ID: ${source.url}`);
      }

      const url = source.url;
      const scriptName = `url:${url}`;
      const script = await Script.findByName(context.storage, this.name, scriptName);
      if (!script) {
        throw new ScriptNotFoundError(this.name, url);
      }

      log.info(`Running script: id=${script.id}, name=${script.name}`);
      const bot = await script.compile(context.mastra);
      const uniqueIds = new Set<string>();

      for (let offset = 0; offset < maxResults; offset += pageSize) {
        const input = { limit: pageSize, offset };
        const run = new Run({ input, scriptId: script.id! });
        await run.save(context.storage);

        try {
          const output = await this.#outputSchema().parseAsync(await bot.run(input));
          const { count, results: botResults, total } = output;
          await run.complete(context.storage, botResults);
          for (const data of botResults) {
            const uniqueId = bot.uniqueId(data);
            uniqueIds.add(uniqueId);
            await new Item({
              data,
              dataSourceId: source.id,
              sourceScriptId: script.id!,
              uniqueId,
            }).save(context.storage);
          }

          results.push(...botResults);
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

  async _register(context: ServiceContext): Promise<void> {
    context.app.get(`/${this.name}/health`, (_req, resp) => {
      resp.status(200).json({ status: 'ok' });
    });

    context.app.get(`/${this.name}/items`, async (req, resp) => {
      const page = parsePositiveInteger(req.query.page, 1);
      const limit = parsePositiveInteger(req.query.limit, apiDefaultLimit);
      if (page === null || limit === null) {
        resp.status(400).json({ error: 'page and limit must be positive integers' });
        return;
      }

      const where = eq(servicesTable.name, this.name);
      const [totalResults, items] = await Promise.all([
        context.storage.db
          .select({ total: count() })
          .from(itemsTable)
          .innerJoin(scriptsTable, eq(itemsTable.sourceScriptId, scriptsTable.id))
          .innerJoin(servicesTable, eq(scriptsTable.serviceId, servicesTable.id))
          .where(where),
        context.storage.db
          .select({ data: itemsTable.data })
          .from(itemsTable)
          .innerJoin(scriptsTable, eq(itemsTable.sourceScriptId, scriptsTable.id))
          .innerJoin(servicesTable, eq(scriptsTable.serviceId, servicesTable.id))
          .where(where)
          .orderBy(itemsTable.uniqueId, itemsTable.dataSourceId)
          .limit(limit)
          .offset((page - 1) * limit),
      ]);
      const [totalResult] = totalResults;

      const results = items.map((item) => item.data);
      resp.json({ count: results.length, results, total: totalResult?.total ?? 0 });
    });

    context.app.get(`/${this.name}/items/:id`, async (req, resp) => {
      const items = await context.storage.db
        .select({ data: itemsTable.data })
        .from(itemsTable)
        .innerJoin(scriptsTable, eq(itemsTable.sourceScriptId, scriptsTable.id))
        .innerJoin(servicesTable, eq(scriptsTable.serviceId, servicesTable.id))
        .where(and(eq(servicesTable.name, this.name), eq(itemsTable.uniqueId, req.params.id)));
      const [item] = items;

      if (!item) {
        resp.status(404).json({ error: 'Item not found' });
        return;
      }

      if (items.length > 1) {
        log.warn(
          `Multiple items found for service=${this.name}, uniqueId=${req.params.id}; returning the first result`
        );
      }

      resp.json(item.data);
    });
  }
}
