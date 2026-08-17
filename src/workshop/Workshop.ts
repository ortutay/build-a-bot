import { Mastra } from '@mastra/core';
import { createWorkflow } from '@mastra/core/workflows';
import { log } from '../logger.js';
import { Bot } from '../bot/Bot.js';
import { Compiler } from '../compile/Compiler.js';
import { defaultMastra } from '../mastra.js';
import type { BuildOptions } from '../types.js';
import { planStep, writeCodeStep } from './steps.js';

export class Workshop {
  constructor() {}

  async build(options: BuildOptions, mastra?: Mastra): Promise<Bot> {
    log.info(`Build a bot:\n\turl=${options.url}\n\tprompt=${options.prompt}`);

    let cleanup: () => Promise<void> = async () => {};

    if (mastra) {
      log.info('Got Mastra:', mastra);
    } else {
      const r = await defaultMastra();
      mastra = r.mastra;
      cleanup = r.cleanup;
      log.info('Instantiated default Mastra:', mastra);
    }

    mastra = mastra!;

    try {
      const workflow = createWorkflow({
        mastra,
        id: 'build-workflow',
        inputSchema: planStep.inputSchema,
        outputSchema: writeCodeStep.outputSchema,
      })
        .then(planStep as any)
        .then(writeCodeStep as any)
        .commit();

      const run = await workflow.createRun();
      const result = await run.start({
        inputData: {
          url: options.url,
          goal: options.prompt,
          inputSchema: options.inputSchema,
          outputSchema: options.outputSchema,
        },
      });

      if (result.status !== 'success') {
        throw new Error(`Workflow did not complete successfully: ${result.status}`);
      }

      const { code } = result.result as any;
      const compiler = new Compiler();
      const out = await compiler.compile(code, mastra.getAgentById('build-agent'));

      const { inputSchema, outputSchema, exampleInput, fn } = out;

      console.log('Compiled input schema:', inputSchema);
      console.log('Compiled output schema:', outputSchema);
      console.log('Compiled example input:', exampleInput);

      const bot = new Bot({ inputSchema, outputSchema, exampleInput, fn });
      return bot;
    } finally {
      await cleanup();
    }
  }

  async plan(options: BuildOptions, mastra?: Mastra): Promise<string> {
    log.info(`Plan a bot:\n\turl=${options.url}\n\tprompt=${options.prompt}`);

    let cleanup: () => Promise<void> = async () => {};

    if (mastra) {
      log.info('Got Mastra:', mastra);
    } else {
      const r = await defaultMastra();
      mastra = r.mastra;
      cleanup = r.cleanup;
      log.info('Instantiated default Mastra:', mastra);
    }

    mastra = mastra!;

    try {
      const workflow = createWorkflow({
        mastra,
        id: 'plan-workflow',
        inputSchema: planStep.inputSchema,
        outputSchema: planStep.outputSchema,
      })
        .then(planStep as any)
        .commit();

      const run = await workflow.createRun();
      const result = await run.start({
        inputData: {
          url: options.url,
          goal: options.prompt,
          inputSchema: options.inputSchema,
          outputSchema: options.outputSchema,
        },
      });

      console.log('Run result:', result);

      const { report } = (result as any).result;

      return report;
    } finally {
      await cleanup();
    }
  }
}
