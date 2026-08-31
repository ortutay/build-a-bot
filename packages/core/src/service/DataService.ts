import { z } from 'zod';
import { availableContext, availableModules } from '../internal/compile/Compiler.js';
import { Script } from '../internal/compile/Script.js';
import { log } from '../internal/logger.js';
import { selectAvailableTools } from '../internal/mastra/instruments/availableTools.js';
import { DataSource } from '../source/DataSource.js';
import { clip } from '../internal/util/index.js';
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

export type DataServiceResult = Record<string, unknown> & {
  meta: {
    source: { url: string };
    foundAt: string;
  };
};

export type DataServiceSyncResult = { results: DataServiceResult[] };

export class ScriptNotFoundError extends Error {
  constructor(serviceName: string, sourceUrl: string) {
    super(`No saved script found for service=${serviceName}, source=${sourceUrl}`);
    this.name = 'ScriptNotFoundError';
  }
}

export class DataService extends Service<DataServiceSyncResult> {
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

  async _build(context: ServiceContext): Promise<void> {
    log.info(`Build data service: ${JSON.stringify(this.itemSchema)}`);

    const inputSchema = z.object({
      limit: z.number().describe('Maximum number of results'),
      offset: z.number().describe('Start gathering results at this offset'),
    });

    for (const source of this.sources) {
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
            inputSchema,
            outputSchema: this.itemSchema,
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

  async _sync(context: ServiceContext): Promise<DataServiceSyncResult> {
    const results: DataServiceResult[] = [];

    for (const source of this.sources) {
      const url = source.url;
      const scriptName = `url:${url}`;
      const script = await Script.findByName(context.storage, this.name, scriptName);
      if (!script) {
        throw new ScriptNotFoundError(this.name, url);
      }

      log.info(`Running script: id=${script.id}, name=${script.name}`);
      const bot = await script.compile(context.mastra);

      // TODO: real input
      // const output = await bot.run(bot.exampleInput);
      const output = await bot.run({
        limit: 100,
        offset: 0,
      });

      const botResults = (output as { results: any[] }).results;
      const { total, count } = output as { total: number; count: number };
      log.info(
        `Ran script id=${script.id}, name=${script.name}, got ${count} of ${total} results, first = ${clip(botResults[0])}`
      );

      // console.log('Bot output:', output);
      // const val = (output as any).results;
      // const val = await this.itemSchema.parseAsync(output);
      // if (typeof val !== 'object' || val === null || Array.isArray(val)) {
      //   throw new Error(`Data script must return an object: name=${script.name}`);
      // }

      for (const r of botResults) {
        results.push({
          ...r,
          meta: {
            source: { url },
            foundAt: new Date().toISOString(),
          },
        });
      }
      log.info(`Stored result: script=${script.name}, source=${url}`);
    }

    return { results };
  }

  async _run(context: ServiceContext): Promise<void> {}
}
