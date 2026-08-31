import type { z } from 'zod';
import { availableContext, availableModules } from '../internal/compile/Compiler.js';
import { Script } from '../internal/compile/Script.js';
import { log } from '../internal/logger.js';
import { selectAvailableTools } from '../internal/mastra/instruments/availableTools.js';
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

export class DataService extends Service {
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
            // inputSchema: options.inputSchema,
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

  async _sync(context: ServiceContext): Promise<void> {
    // TODO:
    // for each this.sources:
    //   pull the script from DB
    //   named error if not found
    //   run it
    //   store results
    // result shape should be output schema, plus field "meta.source", which is { url: ... }
    // add following to meta as well:
    // - foundAt: a timestamp
    // return shape is { results }, which is a list of those results
  }

  async _run(context: ServiceContext): Promise<void> {}
}
