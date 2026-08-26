import { createStep } from '@mastra/core/workflows';
import { log } from '../../logger.js';
import { z } from 'zod';
import * as templates from '../../prompts/templates.js';
import { availableContext, availableModules } from '../../compile/Compiler.js';
import { planStepScorer } from '../scorers/index.js';

const shared = { retries: 2 };

const planStep = <TId extends string>(id: TId, agentId: string) =>
  createStep({
    id,
    ...shared,
    inputSchema: z.object({
      url: z.string(),
      goal: z.string(),
      inputSchema: z.any().optional(),
      outputSchema: z.any().optional(),
    }),
    outputSchema: z.object({
      url: z.string(),
      goal: z.string(),
      report: z.string(),
    }),
    scorers: {
      planStepScorer: {
        scorer: planStepScorer,
        sampling: {
          type: 'ratio',
          rate: 1,
        },
      },
    },
    execute: async ({ inputData, mastra }) => {
      log.info('Running report step');

      const agent = mastra!.getAgentById(agentId);
      const { url, goal } = inputData;

      const prompt = templates.plan.render({
        userInput: templates.userInput.render({ url, goal }),
        inputSchema: inputData.inputSchema
          ? templates.inputSchema.render({
              inputSchema: JSON.stringify(inputData.inputSchema, null, 2),
            })
          : 'User did not specify an input schema',
        outputSchema: inputData.outputSchema
          ? templates.outputSchema.render({
              outputSchema: JSON.stringify(inputData.outputSchema, null, 2),
            })
          : 'User did not specify an output schema',
      });

      // TODO: add a non-tool step in case last response is a tool call, to avoid empty text issue
      const resp = await agent.generate(prompt, { maxSteps: 20 });
      // const resp = await agent.generate(prompt, { maxSteps: 2 });

      let report: string;
      if (resp.text) {
        report = resp.text;
      } else {
        const resp = await agent.generate(prompt, { activeTools: [], toolChoice: 'none' });
        report = resp.text;
      }

      log.debug(`Generated report (${id}): ${report}`);

      return {
        url,
        goal,
        report,
      };
    },
  });

export const fullPlanStep = planStep('plan-step', 'planning-agent');
export const fetchPlanStep = planStep('fetch-plan-step', 'fetch-research-agent');
export const browserPlanStep = planStep('browser-plan-step', 'browser-research-agent');

export const writePlanStep = createStep({
  id: 'write-plan-step',
  ...shared,
  inputSchema: z.object({
    'fetch-plan-step': z.object({
      url: z.string(),
      goal: z.string(),
      report: z.string(),
    }),
    'browser-plan-step': z.object({
      url: z.string(),
      goal: z.string(),
      report: z.string(),
    }),
  }),
  outputSchema: z.object({
    url: z.string(),
    goal: z.string(),
    report: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra!.getAgentById('build-agent');
    log.debug(`Write plan input: ${JSON.stringify(inputData)}`);

    const plans = Object.values(inputData);
    const { url, goal } = plans[0];
    const reports = plans.map((plan) => plan.report);
    log.debug(`Reports to consolidate: ${JSON.stringify(reports)}`);

    const prompt = templates.consolidateIntoPlan.render({
      reports: reports.join('\n\n====================\n\n'),
      userInput: templates.userInput.render({ url, goal }),
    });

    log.debug(`Consolidate reports prompt: ${prompt}`);
    const resp = await agent.generate(prompt);
    const report = resp.text;
    log.debug(`Wrote consolidated report: ${report}`);

    return {
      url,
      goal,
      report,
    };
  },
});

export const writeCodeStep = createStep({
  id: 'write-code-step',
  ...shared,
  inputSchema: fullPlanStep.outputSchema,
  outputSchema: z.object({
    code: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    log.info('Running write code step');

    const agent = mastra!.getAgentById('build-agent');
    const { url, goal, report } = inputData as any;

    log.debug(`Write code report: ${report}`);

    const tools = Object.fromEntries(
      Object.entries(await agent.listTools()).filter(
        ([, tool]) => !('requireApproval' in tool) || !tool.requireApproval
      )
    );

    const renderedReport = templates.report.render({ report });
    log.debug(`Rendered report: ${renderedReport}`);

    const prompt = templates.code.render({
      toolsForCode: templates.toolsForCode.render({
        tools: JSON.stringify(tools, null, 2),
      }),
      userInput: templates.userInput.render({ url, goal }),
      availableModules: JSON.stringify(Object.keys(availableModules)),
      availableContext: JSON.stringify(Object.keys(availableContext)),
      report: renderedReport,
    });

    log.debug(`Write code prompt: ${prompt}`);
    const resp = await agent.generate(prompt);
    const code = resp.text;
    log.debug(`Generated code: ${code}`);

    return { code };
  },
});
