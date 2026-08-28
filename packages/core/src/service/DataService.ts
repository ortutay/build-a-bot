import { type AnyWorkflow } from '@mastra/core/workflows';
import type { z } from 'zod';
import { DataSource } from '../source/DataSource.js';
import { Service, Endpoint, ServiceOptions, ServiceContext } from './Service.js';
// import { Workshop } from '../internal/index.js';
import { log } from '../internal/logger.js';
import { Bot } from '../internal/bot/Bot.js';
import { toBot } from '../internal/compile/toBot.js';

export type DataServiceOptions = ServiceOptions & {
  sources: Record<string, DataSource>;
  itemSchema: z.ZodType;
  // TODO: optional hint?
};

// export type StartDataServiceOptions = StartServiceOptions & {};

export type ScrapeDataOptions = {};

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
    console.log('Build data service:', this.itemSchema);

    for (const source of Object.values(this.sources)) {
      const url = source.url;
      const prompt = 'Build a scraper to get data in the output schema format.';

      log.info(`Build a bot:\n\turl=${url}\n\tprompt=${prompt}`);
      const writeWorkflow = context.mastra.getWorkflowById('write-workflow');
      const run = await writeWorkflow.createRun();
      const result = await run.start({
        inputData: {
          url: url,
          goal: prompt,
          // inputSchema: options.inputSchema,
          outputSchema: this.itemSchema,
        },
      });

      if (result.status !== 'success') {
        throw new Error(`Workflow did not complete successfully: ${result.status}`);
      }
      // const { result } = await runWorkflow(options, writeWorkflow);

      const { code } = result.result as { code: string };
      const bot = await toBot(code, context.mastra);
      console.log('Made a bot:', bot);
    }

    // for (const source of this.sources) {
    //   const ws = new Workshop();
    //   const bot = await ws.build({
    //     url: source.url,
    //     prompt: 'Build a scraper to get data in the output schema format.',
    //     // TODO: standardized input schema
    //     outputSchema: this.itemSchema,
    //   });

    //   console.log('Built a bot:', bot);
    // }
  }

  async heal(context?: ServiceContext): Promise<void> {}
  async sync(context?: ServiceContext): Promise<void> {}
  async run(context?: ServiceContext): Promise<void> {}
}
