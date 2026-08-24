import type { Mastra } from '@mastra/core';
import { type AnyWorkflow, createWorkflow } from '@mastra/core/workflows';
import { log } from '../logger.js';
import { Bot } from '../bot/Bot.js';
import { Compiler } from '../compile/Compiler.js';
import { defaultMastra } from '../mastra/index.js';
import type { BuildOptions } from '../types.js';
import { fullPlanStep, planSteps, writePlanStep, writeCodeStep } from './steps.js';

// type WorkflowRun = {
//   mastra: Mastra;
//   cleanup: () => Promise<void>;
//   result: Extract<
//     Awaited<ReturnType<Awaited<ReturnType<AnyWorkflow['createRun']>>['start']>>,
//     { status: 'success' }
//   >;
// };

// const sharedWorkflow = (mastra: Mastra, id: string) => createWorkflow({
//   mastra,
//   id,
//   inputSchema: fetchPlanStep.inputSchema,
//   outputSchema: writeCodeStep.outputSchema,
// })
//   .parallel([
//     fetchPlanStep as any,
//     browserPlanStep as any,
//   ]);
// const planSteps = [
// ];

const planWorkflow = (mastra: Mastra) =>
  createWorkflow({
    mastra,
    id: 'plan-workflow',
    inputSchema: planSteps[0].inputSchema,
    outputSchema: planSteps[0].outputSchema,
  })
    // .parallel(planSteps)
    .then(fullPlanStep)
    .then(writeCodeStep)
    .commit();

const writeWorkflow = (mastra: Mastra) =>
  createWorkflow({
    mastra,
    id: 'write-workflow',
    inputSchema: planSteps[0].inputSchema,
    outputSchema: writeCodeStep.outputSchema,
  })
    // .parallel(planSteps)
    // .then(writePlanStep)
    .then(fullPlanStep)
    .then(writeCodeStep)
    .commit();

const runWorkflow = async (
  workflowFactory: (mastra: Mastra) => AnyWorkflow,
  options: BuildOptions
): Promise<any> => {
  const { mastra, cleanup } = await defaultMastra();
  log.info(`Instantiated default Mastra`);

  try {
    const workflow = workflowFactory(mastra);
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

    return { mastra, cleanup, result };
  } finally {
    await cleanup();
  }
};

export class Workshop {
  async build(options: BuildOptions): Promise<Bot> {
    log.info(`Build a bot:\n\turl=${options.url}\n\tprompt=${options.prompt}`);

    const { mastra, cleanup, result } = await runWorkflow(writeWorkflow, options);
    try {
      const { code } = result.result as { code: string };
      const compiler = new Compiler();
      const out = await compiler.compile(code, mastra.getAgentById('build-agent'));
      const { inputSchema, outputSchema, exampleInput, fn } = out;

      return new Bot({ inputSchema, outputSchema, exampleInput, fn });
    } finally {
      await cleanup();
    }
  }

  async plan(options: BuildOptions): Promise<string> {
    log.info(`Plan a bot:\n\turl=${options.url}\n\tprompt=${options.prompt}`);
    const result = await runWorkflow(planWorkflow, options);
    log.debug(`Workflow result: ${JSON.stringify(result)}`);
    const report = result.result.report;
    log.debug(`Returning report: ${report}`);
    return report;
  }
}
