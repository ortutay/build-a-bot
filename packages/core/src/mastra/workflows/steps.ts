import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { Compiler, availableContext, availableModules } from '../../compile/Compiler.js';
import { log } from '../../logger.js';
import * as templates from '../../prompts/templates.js';
import { getOrNull, norm } from '../../util/index.js';
import { selectAvailableTools } from '../instruments/availableTools.js';

const shared = { retries: 2 };
const jsonSchema = z.record(z.string(), z.unknown());

const groupingSchema = z.object({
  groupingName: z.string().describe('Short unique name of this grouping, kebab-case'),
  groupingDescription: z.string().describe('Description of this grouping'),
  urls: z.array(z.string()).describe('URLs that this grouping applies to'),
  goal: z.string(),
  report: z.string().describe('Report specific for this grouping'),
  itemSchema: jsonSchema,
  modules: z.array(z.string()),
  context: z.array(z.string()),
  tools: z.array(z.string()),
});

const planOutputSchema = z.object({
  generalReport: z.string().describe('Report that applies to all groups'),
  groupings: z.array(groupingSchema).min(1),
});

const planAgentGroupingSchema = groupingSchema
  .omit({ context: true, itemSchema: true, modules: true, tools: true })
  .extend({
    itemSchema: z
      .string()
      .nullable()
      .describe(
        'Null when the caller supplies an item schema; otherwise a JSON-encoded item schema without Markdown fences'
      ),
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

const parseGeneratedSchema = (val: string | null, name: string): Record<string, unknown> => {
  try {
    return jsonSchema.parse(JSON.parse(val ?? 'null'));
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
    itemSchema: jsonSchema.optional(),
    modules: z.array(z.string()),
    context: z.array(z.string()),
    tools: z.array(z.string()),
  }),
  outputSchema: planOutputSchema,
  execute: async ({ inputData, mastra }) => {
    log.info('Running report step');

    const agent = mastra!.getAgentById('planning-agent');
    const { goal, modules, context, tools } = inputData;
    const urls = norm(inputData.urls);

    const prompt = templates.plan.render({
      userInput: templates.userInput.render({ urls: urls.join('\n'), goal }),
      itemSchema:
        inputData.itemSchema === undefined
          ? 'No item schema was supplied. Generate one from the user goal and your research.'
          : JSON.stringify(inputData.itemSchema, null, 2),
    });

    let resp = await agent.generate(prompt, {
      maxSteps: 20,
      structuredOutput: { schema: planAgentOutputSchema },
    });
    if (!resp.object && !resp.error && !resp.tripwire && resp.steps.length >= 20) {
      log.info('Planning research budget exhausted; finalizing from collected evidence.');
      resp = await agent.generate(
        [
          ...resp.messages,
          {
            role: 'user',
            content:
              'The research budget is exhausted. Return the required structured plan now, using only collected evidence. Do not call tools or invent missing findings. Describe unverified or inaccessible data honestly and preserve the supplied schema and URL partition.',
          },
        ],
        { maxSteps: 1, toolChoice: 'none', structuredOutput: { schema: planAgentOutputSchema } }
      );
    }
    if (!resp.object) {
      throw new Error('Planner did not return a structured report', { cause: resp.error });
    }
    const planned = planAgentOutputSchema.parse(resp.object);
    const { generalReport } = planned;
    const groupings = planned.groupings.map((grouping) => ({
      ...grouping,
      groupingName: grouping.groupingName.trim(),
      urls: norm(grouping.urls),
    }));
    const groupingNames = groupings.map((grouping) => grouping.groupingName);
    if (
      groupingNames.some((name) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) ||
      new Set(groupingNames).size !== groupingNames.length
    ) {
      throw new Error('Grouping names must be unique, non-empty kebab-case strings');
    }
    const groupingUrls = groupings.flatMap((grouping) => grouping.urls);
    if (
      groupingUrls.length !== urls.length ||
      JSON.stringify(norm(groupingUrls)) !== JSON.stringify(urls)
    ) {
      throw new Error('Grouping URLs must be an exact partition of the seed URLs');
    }

    log.debug(`Generated report: ${generalReport}`);

    return {
      generalReport,
      groupings: groupings.map((grouping) => ({
        ...grouping,
        groupingName: grouping.groupingName,
        groupingDescription: grouping.groupingDescription,
        itemSchema:
          inputData.itemSchema ?? parseGeneratedSchema(grouping.itemSchema, 'item schema'),
        modules,
        context,
        tools,
      })),
    };
  },
});

export const writeCodeStep = createStep({
  id: 'write-code-step',
  // Generation retries are bounded per group below.
  retries: 0,
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
    const outputs = await Promise.allSettled(
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
        const prompt = templates.code.render({
          toolsForCode: templates.toolsForCode.render({
            tools: JSON.stringify(tools, null, 2),
          }),
          userInput: templates.userInput.render({
            urls: grouping.urls.join('\n'),
            goal: grouping.goal,
          }),
          itemSchema: JSON.stringify(grouping.itemSchema, null, 2),
          availableModules: JSON.stringify(Object.keys(modules)),
          availableContext: JSON.stringify(Object.keys(context)),
          generalReport: inputData.generalReport,
          groupingName: grouping.groupingName,
          groupingUrls: JSON.stringify(grouping.urls, null, 2),
          groupingReport: grouping.report,
        });

        log.debug(`Write code prompt for ${grouping.groupingName}: ${prompt}`);
        let failure = 'No JavaScript generated';
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const resp = await agent.generate(
              attempt
                ? `${prompt}\nPrevious attempt failed: ${failure}. Correct that failure.`
                : prompt,
              { maxSteps: 1, toolChoice: 'none' }
            );
            if (!resp.text.trim()) {
              throw new Error('Code generation returned no JavaScript');
            }
            await new Compiler().compile(resp.text, {
              additionalContext: { ...context, ...modules, tools: {} },
            });
            log.debug(`Generated code for ${grouping.groupingName}: ${resp.text}`);
            return { groupingName: grouping.groupingName, code: resp.text };
          } catch (e) {
            failure = e instanceof Error ? e.message : String(e);
          }
        }
        throw new Error(`Script generation failed for ${grouping.groupingName}: ${failure}`);
      })
    );
    return outputs.map((val) => {
      if (val.status === 'rejected') {
        throw val.reason;
      }
      return val.value;
    });
  },
});
