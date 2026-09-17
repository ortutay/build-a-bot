import { isDeepStrictEqual } from 'node:util';
import { type ToolsetsInput } from '@mastra/core/agent';
import { standardSchemaToJSONSchema, toStandardSchema } from '@mastra/core/schema';
import { type ToolAction } from '@mastra/core/tools';
import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { Compiler, availableContext, availableModules } from '../../compile/Compiler.js';
import { toContextTools } from '../../compile/tool-fns.js';
import { failureScript } from '../../compile/failureScript.js';
import { Bot } from '../../bot/Bot.js';
import { log } from '../../logger.js';
import * as templates from '../../prompts/templates.js';
import { getOrNull, norm, errorString, indentCode } from '../../util/index.js';
import { selectAvailableTools } from '../instruments/availableTools.js';
import {
  codeEvaluationOutputSchema,
  planAgentOutputSchema,
  planInputSchema,
  planOutputSchema,
  writeCodeStepOutputschema,
  healAgentOutputSchema,
  healInputSchema,
  healOutputSchema,
} from './schemas.js';

const shared = { retries: 2 };

export const toolsJsonForPrompt = (
  tools: Record<string, Pick<ToolAction<any, any>, 'description' | 'inputSchema' | 'outputSchema'>>
): string => {
  const schemaForPrompt = (schema: ToolAction<any, any>['inputSchema'], io: 'input' | 'output') => {
    if (schema === undefined) {
      return undefined;
    }

    const jsonSchema = standardSchemaToJSONSchema(toStandardSchema(schema), { io });
    return Object.fromEntries(Object.entries(jsonSchema).filter(([key]) => key !== '$schema'));
  };

  return JSON.stringify(
    Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => [
        name,
        {
          description: tool.description,
          inputSchema: schemaForPrompt(tool.inputSchema, 'input'),
          outputSchema: schemaForPrompt(tool.outputSchema, 'output'),
        },
      ])
    ),
    null,
    2
  );
};

const getAvailable = <T>(vals: Record<string, T>, name: string, type: string): T => {
  const val = getOrNull<T>(vals, name);
  if (val === null) {
    throw new Error(`Requested ${type} is not available: ${name}`);
  }

  return val;
};

export const planStep = createStep({
  id: 'plan-step',
  ...shared,
  inputSchema: planInputSchema,
  outputSchema: planOutputSchema,
  execute: async ({ inputData, mastra }) => {
    log.info('Running report step');

    const agent = mastra!.getAgentById('planning-agent');
    const { goal, modules, context, tools } = inputData;
    const urls = norm(inputData.urls);

    const prompt = templates.plan.render({
      userInput: templates.userInput.render({ urls: urls.join('\n'), goal }),
      capabilities: JSON.stringify({ modules, context, tools }, null, 2),
      itemSchema: JSON.stringify(inputData.itemSchema, null, 2),
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
      throw new Error('Planner did not return a structured report', {
        cause: resp.error ?? resp.tripwire,
      });
    }
    const plan = planOutputSchema.parse({
      ...resp.object,
      goal,
      modules,
      context,
      tools,
      itemSchema: inputData.itemSchema,
    });

    log.debug(`Generated report: ${plan.report}`);
    return plan;
  },
});

export const writeCodeStep = createStep({
  id: 'write-code-step',
  // Generation retries are bounded per group below.
  retries: 0,
  inputSchema: planStep.outputSchema,
  outputSchema: z.array(writeCodeStepOutputschema),
  execute: async ({ inputData, mastra }) => {
    log.info('Running write code step');

    const agent = mastra!.getAgentById('build-agent');

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

    const groupingToCode = async (
      grouping: z.infer<typeof planOutputSchema>['groupings'][number]
    ) => {
      log.info(`Write code for ${grouping.groupingName}`);
      const prompt = templates.code.render({
        userInput: templates.userInput.render({
          urls: grouping.urls.join('\n'),
          goal: inputData.goal,
        }),
        toolsForCode: templates.toolsForCode.render({
          tools: toolsJsonForPrompt(tools),
        }),
        itemSchema: JSON.stringify(inputData.itemSchema, null, 2),
        availableModules: JSON.stringify(Object.keys(modules)),
        availableContext: JSON.stringify(Object.keys(context)),
        report: inputData.report,
        groupingDescription: grouping.groupingDescription,
        groupingName: grouping.groupingName,
        groupingUrls: JSON.stringify(grouping.urls, null, 2),
      });

      let failure = 'No JavaScript generated';
      let previousCode: string | undefined;
      const maxAttempts = 3;

      for (let i = 0; i < maxAttempts; i++) {
        log.info(
          `Write code prompt attempt ${i + 1} of ${maxAttempts} for ${grouping.groupingName}`
        );
        const retryPrompt =
          previousCode === undefined
            ? prompt
            : `${prompt}\n\n# Previous attempt failed\n\nThe previous code did not compile. Correct the failure below and return replacement JavaScript.\n\n<previous-code>\n${previousCode}\n</previous-code>\n\n<failure>\n${failure}\n</failure>`;
        log.debug(`Write code prompt is: ${retryPrompt}`);
        try {
          const resp = await agent.generate(retryPrompt, { maxSteps: 1, toolChoice: 'none' });
          const code = resp.text;
          previousCode = code;
          await new Compiler().compileBot(code, {
            additionalContext: { ...context, ...modules, tools: [] },
          });

          return {
            groupingName: grouping.groupingName,
            code,
          };
        } catch (e) {
          failure = e instanceof Error ? e.message : String(e);
        }
      }

      return {
        groupingName: grouping.groupingName,
        code: failureScript(grouping.urls, `Script generation failed: ${failure}`),
      };
    };

    const outputs = await Promise.allSettled(inputData.groupings.map(groupingToCode));

    return outputs.map((val, i) => {
      if (val.status === 'fulfilled') {
        return val.value;
      }
      const grouping = inputData.groupings[i]!;
      return {
        groupingName: grouping.groupingName,
        code: failureScript(grouping.urls, String(val.reason)),
      };
    });
  },
});

export const healCodeStep = createStep({
  id: 'heal-code-step',
  inputSchema: healInputSchema,
  outputSchema: healOutputSchema,
  execute: async ({ inputData, mastra }) => {
    log.info(`Running heal step`);

    const agent = mastra!.getAgentById('build-agent');

    let bot: Bot | undefined;
    let code = inputData.code;
    let codeChanged = false;
    let output: z.infer<typeof healAgentOutputSchema> | undefined;
    const maxAttempts = 3;

    let errors: any[] = [];

    const selectRequested = <T>(
      names: string[],
      available: Record<string, T>,
      type: string
    ): Record<string, T> =>
      Object.fromEntries(
        names.flatMap((name) => {
          const val = getOrNull<T>(available, name);
          if (val === null) {
            errors.push({
              type: `${type} selection error`,
              dump: `Requested ${type} is no longer available: ${name}`,
            });
            return [];
          }
          return [[name, val] as const];
        })
      );

    const availableTools = selectAvailableTools(mastra!.listTools() ?? {});
    const requestedTools = selectRequested(inputData.tools, availableTools, 'tool');
    const context = selectRequested(inputData.context, availableContext, 'context');
    const modules = selectRequested(inputData.modules, availableModules, 'module');
    const tools = Object.fromEntries(
      Object.entries(requestedTools).flatMap(([name, tool]) => {
        if ('requireApproval' in tool && tool.requireApproval) {
          errors.push({
            type: 'tool selection error',
            dump: `Requested tool requires approval: ${name}`,
          });
          return [];
        }
        return [[name, tool] as const];
      })
    );

    for (let i = 0; i < maxAttempts; i++) {
      log.info(`Heal attempt #${i + 1} of ${maxAttempts}`);

      const compileCode = async (code: string) => {
        try {
          const bot = await new Compiler().compileBot(code, {
            additionalContext: { ...context, ...modules, tools: toContextTools(tools) },
          });
          log.info(`Successfuly compiled code`);
          return bot;
        } catch (e) {
          log.info(`Heal got error while compiling bot code: ${errorString(e)}`);
          errors.push({
            type: 'code compilation error',
            dump: errorString(e),
          });
        }
      };

      bot = await compileCode(code);

      const prompt = templates.heal.render({
        userInput: templates.userInput.render({
          urls: inputData.urls.join('\n'),
          goal: inputData.goal,
        }),
        toolsForCode: templates.toolsForCode.render({
          tools: toolsJsonForPrompt(tools),
        }),
        itemSchema: JSON.stringify(inputData.itemSchema, null, 2),
        availableModules: JSON.stringify(Object.keys(modules)),
        availableContext: JSON.stringify(Object.keys(context)),
        errors: errors.length ? JSON.stringify(errors) : 'No errors',
        code,
      });

      const toolsets: ToolsetsInput = bot ? { bot: bot.createTools('bot') } : {};

      const resp = await agent.generate(prompt, {
        structuredOutput: { schema: healAgentOutputSchema },
        toolsets,
        maxSteps: 20,
      });

      errors = [];

      output = healAgentOutputSchema.parse(resp.object);
      const { report, rating, noChanges, code: updatedCode } = output;
      log.info(`Heal result: noChanges=${noChanges}, rating=${rating}, report=${report}`);
      if (updatedCode) {
        log.debug(`Heal gave new code:\n${indentCode(updatedCode)}`);
        if (await compileCode(updatedCode)) {
          code = updatedCode;
          codeChanged = true;
        }
      }

      if (bot && noChanges) {
        break;
      }
    }

    return healOutputSchema.parse({
      ...output!,
      shouldSave:
        codeChanged ||
        !isDeepStrictEqual(inputData.context, Object.keys(context)) ||
        !isDeepStrictEqual(inputData.modules, Object.keys(modules)) ||
        !isDeepStrictEqual(inputData.tools, Object.keys(tools)),
      code: codeChanged ? code : null,
      context: Object.keys(context),
      modules: Object.keys(modules),
      tools: Object.keys(tools),
    });
  },
});
