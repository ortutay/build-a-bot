import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { availableContext, availableModules } from '../../compile/Compiler.js';
import { log } from '../../logger.js';
import * as templates from '../../prompts/templates.js';
import { getOrNull } from '../../util/index.js';
import { selectAvailableTools } from '../instruments/availableTools.js';

const shared = { retries: 2 };
const jsonSchema = z.record(z.string(), z.unknown());

const groupingSchema = z.object({
  groupingName: z.string().describe('Short unique name of this grouping, kebab-case'),
  groupingDescription: z.string().describe('Description of this grouping'),
  urls: z.array(z.string()).describe('URLs that this grouping applies to'),
  goal: z.string(),
  report: z.string().describe('Report specific for this grouping'),
  outputSchema: jsonSchema,
  modules: z.array(z.string()),
  context: z.array(z.string()),
  tools: z.array(z.string()),
});

const planOutputSchema = z.object({
  generalReport: z.string().describe('Report that applies to all groups'),
  groupings: z.array(groupingSchema).min(1),
});

const planAgentGroupingSchema = groupingSchema
  .omit({ context: true, modules: true, outputSchema: true, tools: true })
  .extend({
    outputSchema: z.string().describe('A JSON-encoded output schema without Markdown fences'),
  });

const planAgentOutputSchema = z.object({
  generalReport: z.string().describe('Report that applies to all groups'),
  groupings: z.array(planAgentGroupingSchema).min(1),
});

const getAvailable = <T>(vals: Record<string, T>, name: string, type: string): T => {
  const val = getOrNull<T>(vals, name);
  if (val === null) {
    throw new Error(`Requested ${type} is not available: ${name}`);
  }

  return val;
};

const parseGeneratedSchema = (val: string, name: string): Record<string, unknown> => {
  try {
    return jsonSchema.parse(JSON.parse(val));
  } catch (e) {
    throw new Error(`Generated ${name} must be a JSON object`, { cause: e });
  }
};

export const planStep = createStep({
  id: 'plan-step',
  ...shared,
  inputSchema: z.object({
    urls: z.array(z.string()),
    goal: z.string(),
    // inputSchema: jsonSchema.optional(),
    outputSchema: jsonSchema.optional(),
    modules: z.array(z.string()),
    context: z.array(z.string()),
    tools: z.array(z.string()),
  }),
  outputSchema: planOutputSchema,
  execute: async ({ inputData, mastra }) => {
    log.info('Running report step');

    const agent = mastra!.getAgentById('planning-agent');
    const { urls, goal, modules, context, tools } = inputData;

    const prompt = templates.plan.render({
      userInput: templates.userInput.render({ urls: urls.join('\n'), goal }),
      // inputSchema:
      //     inputData.inputSchema === undefined
      //       ? 'No input schema was supplied. Generate one from the user goal and your research.'
      //       : JSON.stringify(inputData.inputSchema, null, 2),
      outputSchema:
        inputData.outputSchema === undefined
          ? 'No output schema was supplied. Generate one from the user goal and your research.'
          : JSON.stringify(inputData.outputSchema, null, 2),
    });

    const resp = await agent.generate(prompt, {
      maxSteps: 20,
      structuredOutput: { schema: planAgentOutputSchema },
    });
    const { generalReport, groupings } = resp.object;

    log.debug(`Generated report: ${generalReport}`);

    return {
      generalReport,
      groupings: groupings.map((grouping) => ({
        ...grouping,
        groupingName: grouping.groupingName,
        groupingDescription: grouping.groupingDescription,
        // inputSchema: parseGeneratedSchema(grouping.inputSchema, 'input schema'),
        outputSchema: parseGeneratedSchema(grouping.outputSchema, 'output schema'),
        modules,
        context,
        tools,
      })),
    };
  },
});

export const writePlanStep = createStep({
  id: 'write-plan-step',
  ...shared,
  inputSchema: z.object({
    'fetch-plan-step': z.object({
      urls: z.array(z.string()),
      goal: z.string(),
      report: z.string(),
      // inputSchema: jsonSchema,
      outputSchema: jsonSchema,
    }),
    'browser-plan-step': z.object({
      urls: z.array(z.string()),
      goal: z.string(),
      report: z.string(),
      // inputSchema: jsonSchema,
      outputSchema: jsonSchema,
    }),
  }),
  outputSchema: z.object({
    urls: z.array(z.string()),
    goal: z.string(),
    report: z.string(),
    // inputSchema: jsonSchema,
    outputSchema: jsonSchema,
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra!.getAgentById('build-agent');
    log.debug(`Write plan input: ${JSON.stringify(inputData)}`);

    const plans = Object.values(inputData);
    const { urls, goal, outputSchema } = plans[0];
    const reports = plans.map((plan) => plan.report);
    log.debug(`Reports to consolidate: ${JSON.stringify(reports)}`);

    const prompt = templates.consolidateIntoPlan.render({
      reports: reports.join('\n\n====================\n\n'),
      userInput: templates.userInput.render({ urls: urls.join('\n'), goal }),
    });

    log.debug(`Consolidate reports prompt: ${prompt}`);
    const resp = await agent.generate(prompt);
    const report = resp.text;
    log.debug(`Wrote consolidated report: ${report}`);

    return {
      urls,
      goal,
      report,
      // inputSchema,
      outputSchema,
    };
  },
});

export const writeCodeStep = createStep({
  id: 'write-code-step',
  ...shared,
  inputSchema: planOutputSchema,
  outputSchema: z.array(
    z.object({
      groupingName: z.string(),
      code: z.string(),
    })
  ),
  execute: async ({ inputData, mastra }) => {
    log.info('Running write code step');

    const agent = mastra!.getAgentById('build-agent');
    const availableTools = selectAvailableTools(mastra!.listTools() ?? {});
    return Promise.all(
      inputData.groupings.map(async (grouping) => {
        log.debug(`Write code report for ${grouping.groupingName}: ${grouping.report}`);

        const tools = Object.fromEntries(
          grouping.tools.map((name) => {
            const tool = getAvailable(availableTools, name, 'tool');
            if ('requireApproval' in tool && tool.requireApproval) {
              throw new Error(`Requested tool requires approval: ${name}`);
            }

            return [name, tool];
          })
        );
        const context = Object.fromEntries(
          grouping.context.map((name) => [name, getAvailable(availableContext, name, 'context')])
        );
        const modules = Object.fromEntries(
          grouping.modules.map((name) => [name, getAvailable(availableModules, name, 'module')])
        );
        const renderedReport = templates.report.render({
          report: `${inputData.generalReport}\n\n${grouping.report}`,
        });
        const prompt = templates.code.render({
          toolsForCode: templates.toolsForCode.render({
            tools: JSON.stringify(tools, null, 2),
          }),
          userInput: templates.userInput.render({
            urls: grouping.urls.join('\n'),
            goal: grouping.goal,
          }),
          // inputSchema: JSON.stringify(grouping.inputSchema, null, 2),
          outputSchema: JSON.stringify(grouping.outputSchema, null, 2),
          availableModules: JSON.stringify(Object.keys(modules)),
          availableContext: JSON.stringify(Object.keys(context)),
          report: renderedReport,
        });

        log.debug(`Write code prompt for ${grouping.groupingName}: ${prompt}`);
        const resp = await agent.generate(prompt);
        log.debug(`Generated code for ${grouping.groupingName}: ${resp.text}`);

        return { groupingName: grouping.groupingName, code: resp.text };
      })
    );
  },
});
