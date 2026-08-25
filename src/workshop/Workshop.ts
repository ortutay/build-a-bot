import { type AnyWorkflow, createWorkflow } from '@mastra/core/workflows';
import { log } from '../logger.js';
import { Bot } from '../bot/Bot.js';
import { toBot } from '../compile/toBot.js';
import { mastra } from '../mastra/index.js';
import type { BuildOptions } from '../types.js';
import { fullPlanStep, writeCodeStep } from './steps.js';

export const planWorkflow = createWorkflow({
  mastra,
  id: 'plan-workflow',
  inputSchema: fullPlanStep.inputSchema,
  outputSchema: fullPlanStep.outputSchema,
})
  .then(fullPlanStep)
  .then(writeCodeStep)
  .commit();

export const writeWorkflow = createWorkflow({
  mastra,
  id: 'write-workflow',
  inputSchema: fullPlanStep.inputSchema,
  outputSchema: writeCodeStep.outputSchema,
})
  .then(fullPlanStep)
  .then(writeCodeStep)
  .commit();

const runWorkflow = async (options: BuildOptions, workflow: AnyWorkflow): Promise<any> => {
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

  return { result };
};

export class Workshop {
  async build(options: BuildOptions): Promise<Bot> {
    log.info(`Build a bot:\n\turl=${options.url}\n\tprompt=${options.prompt}`);
    const { result } = await runWorkflow(options, writeWorkflow);
    const { code } = result.result as { code: string };
    return toBot(code);
  }

  async plan(options: BuildOptions): Promise<string> {
    log.info(`Plan a bot:\n\turl=${options.url}\n\tprompt=${options.prompt}`);
    const result = await runWorkflow(options, planWorkflow);
    log.debug(`Workflow result: ${JSON.stringify(result)}`);
    const report = result.result.report;
    log.debug(`Returning report: ${report}`);
    return report;
  }
}
