import { z } from 'zod';
import { availableContext, availableModules } from '../internal/compile/Compiler.js';
import { Run } from '../internal/compile/Run.js';
import { Script } from '../internal/compile/Script.js';
import { log } from '../internal/logger.js';
import { selectAvailableTools } from '../internal/mastra/instruments/availableTools.js';
import { clip } from '../internal/util/index.js';
import { DataSource } from '../source/DataSource.js';
import {
  type Endpoint,
  type ServiceContext,
  type ServiceOptions,
  type ServiceConstructorOptions,
  Service,
} from './Service.js';

export type DataServiceOptions = ServiceOptions & {
  sources: DataSource[];
  itemSchema: z.ZodType;
  // TODO: optional hint?
};

type DataServiceConstructorOptions = ServiceConstructorOptions & DataServiceOptions;

export type DataServiceResult = { results: unknown[] };

const pageSize = 100;
const maxResults = 1000;

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

  get endpoints(): Endpoint[] {
    return [];
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
      const url = source.url;
      const prompt = 'Build a scraper to get data in the output schema format.';
      const scriptName = `url:${url}`;
      let script = await Script.findByName(context.storage, this.name, scriptName);

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
    }
  }

  async _heal(context: ServiceContext): Promise<void> {}

  async _sync(context: ServiceContext): Promise<DataServiceResult> {
    const results: unknown[] = [];

    for (const source of this.sources) {
      await source.save(context.storage);

      const url = source.url;
      const scriptName = `url:${url}`;
      const script = await Script.findByName(context.storage, this.name, scriptName);
      if (!script) {
        throw new ScriptNotFoundError(this.name, url);
      }

      log.info(`Running script: id=${script.id}, name=${script.name}`);
      const bot = await script.compile(context.mastra);

      for (let offset = 0; offset < maxResults; offset += pageSize) {
        const input = { limit: pageSize, offset };
        const run = new Run({ input, scriptId: script.id! });
        await run.save(context.storage);

        try {
          const output = await this.#outputSchema().parseAsync(await bot.run(input));
          const { count, results: botResults, total } = output;
          await run.complete(context.storage, botResults);

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
    }

    return { results };
  }

  async _run(context: ServiceContext): Promise<void> {
    context.app.get(`/${this.name}/health`, (_req, resp) => {
      resp.status(200).json({ status: 'ok' });
    });
  }
}
