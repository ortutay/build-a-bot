import { createStep } from '@mastra/core/workflows';
import { log } from '../logger.js';
import { z } from 'zod';
import * as templates from '../prompts/templates.js';
import { availableContext, availableModules } from '../compile/Compiler.js';

export const planStep = createStep({
  id: 'plan-step',
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
  execute: async ({ inputData, mastra }) => {
    log.info('Running report step');

    const agent = mastra!.getAgentById('build-agent');
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
    // console.log('Plan resp:', resp);

    let report: string;
    if (resp.text) {
      report = resp.text;
    } else {
      const resp = await agent.generate(prompt, { activeTools: [], toolChoice: 'none' });
      report = resp.text;
    }
    // log.info('Generated report:', report);

    return {
      url,
      goal,
      report,
    };
  },
});

export const writeCodeStep = createStep({
  id: 'write-code-step',
  inputSchema: planStep.outputSchema,
  outputSchema: z.object({
    code: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    log.info('Running write code step');

    const agent = mastra!.getAgentById('build-agent');
    const { url, goal, report } = inputData as any;

    console.log('Write code got report:', report);

    const tools = Object.fromEntries(
      Object.entries(await agent.listTools()).filter(
        ([, tool]) => !('requireApproval' in tool) || !tool.requireApproval
      )
    );

    const renderedReport = templates.report.render({ report });
    console.log('renderedReport:', renderedReport);

    const prompt = templates.code.render({
      toolsForCode: templates.toolsForCode.render({
        tools: JSON.stringify(tools, null, 2),
      }),
      userInput: templates.userInput.render({ url, goal }),
      availableModules: JSON.stringify(Object.keys(availableModules)),
      availableContext: JSON.stringify(Object.keys(availableContext)),
      report: renderedReport,
    });

    console.log('Write code prompt:', prompt);
    const resp = await agent.generate(prompt);

    const code = resp.text;
    log.info('Generated code:', code);

    return { code };
  },
});
