import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { availableContext, availableModules } from '../../compile/Compiler.js';
import { log } from '../../logger.js';
import * as templates from '../../prompts/templates.js';
import { selectAvailableTools } from '../instruments/availableTools.js';
import { getOrNull } from '../../util/index.js';

const shared = { retries: 2 };

export const writeWorkflowInputSchema = z.object({
  url: z.string(),
  goal: z.string(),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  modules: z.array(z.string()),
  context: z.array(z.string()),
  tools: z.array(z.string()),
});

const planOutputSchema = z.object({
  url: z.string(),
  goal: z.string(),
  report: z.string(),
  modules: z.array(z.string()),
  context: z.array(z.string()),
  tools: z.array(z.string()),
});

const getAvailable = <T>(vals: Record<string, T>, name: string, type: string): T => {
  const val = getOrNull<T>(vals, name);
  if (val === null) {
    throw new Error(`Requested ${type} is not available: ${name}`);
  }

  return val;
};

const planStep = <TId extends string>(id: TId, agentId: string) =>
  createStep({
    id,
    ...shared,
    inputSchema: writeWorkflowInputSchema,
    outputSchema: planOutputSchema,
    execute: async ({ inputData, mastra }) => {
      log.info('Running report step');

      const agent = mastra!.getAgentById(agentId);
      const { url, goal, modules, context, tools } = inputData;

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
        modules,
        context,
        tools,
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
  inputSchema: planOutputSchema,
  outputSchema: z.object({
    code: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    log.info('Running write code step');

    const agent = mastra!.getAgentById('build-agent');
    const { url, goal, report } = inputData;

    log.debug(`Write code report: ${report}`);

    const availableTools = selectAvailableTools(mastra!.listTools() ?? {});
    const tools = Object.fromEntries(
      inputData.tools.map((name) => {
        const tool = getAvailable(availableTools, name, 'tool');
        if ('requireApproval' in tool && tool.requireApproval) {
          throw new Error(`Requested tool requires approval: ${name}`);
        }

        return [name, tool];
      })
    );
    const context = Object.fromEntries(
      inputData.context.map((name) => [name, getAvailable(availableContext, name, 'context')])
    );
    const modules = Object.fromEntries(
      inputData.modules.map((name) => [name, getAvailable(availableModules, name, 'module')])
    );

    const renderedReport = templates.report.render({ report });
    log.debug(`Rendered report: ${renderedReport}`);

    const prompt = templates.code.render({
      toolsForCode: templates.toolsForCode.render({
        tools: JSON.stringify(tools, null, 2),
      }),
      userInput: templates.userInput.render({ url, goal }),
      availableModules: JSON.stringify(Object.keys(modules)),
      availableContext: JSON.stringify(Object.keys(context)),
      report: renderedReport,
    });

    log.debug(`Write code prompt: ${prompt}`);
    const resp = await agent.generate(prompt);
    const code = resp.text;
    log.debug(`Generated code: ${code}`);

    return { code };
  },
});
