import type { z } from 'zod';
import { toBot } from '../internal/compile/toBot.js';
import { log } from '../internal/logger.js';
import { DataSource } from '../source/DataSource.js';
import { type Endpoint, Service, type ServiceContext, type ServiceOptions } from './Service.js';

export type DataServiceOptions = ServiceOptions & {
  sources: Record<string, DataSource>;
  itemSchema: z.ZodType;
  // TODO: optional hint?
};

export class DataService extends Service {
  itemSchema: z.ZodType;
  sources: Record<string, DataSource>;

  constructor(options: DataServiceOptions) {
    super(options);
    this.sources = options.sources;
    this.itemSchema = options.itemSchema;
  }

  get endpoints(): Endpoint[] {
    return [];
  }

  async _build(context: ServiceContext): Promise<void> {
    log.info(`Build data service: ${String(this.itemSchema)}`);

    for (const source of Object.values(this.sources)) {
      const url = source.url;
      const prompt = 'Build a scraper to get data in the output schema format.';

      log.info(`Build a bot:\n\turl=${url}\n\tprompt=${prompt}`);
      const writeWorkflow = context.mastra.getWorkflowById('write-workflow');
      const run = await writeWorkflow.createRun();
      const result = await run.start({
        inputData: {
          url,
          goal: prompt,
          // inputSchema: options.inputSchema,
          outputSchema: this.itemSchema,
        },
      });

      if (result.status !== 'success') {
        throw new Error(`Workflow did not complete successfully: ${result.status}`);
      }
      const { code } = result.result as { code: string };
      const bot = await toBot(code, context.mastra);
      log.info(`Made a bot: ${String(bot)}`);
    }
  }

  async heal(context?: ServiceContext): Promise<void> {}
  async sync(context?: ServiceContext): Promise<void> {}
  async run(context?: ServiceContext): Promise<void> {}
}
