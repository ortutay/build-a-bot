import { Mastra } from '@mastra/core';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { log } from '../logger.js';
import { type AgentOptions } from '../agent/Agent.js';
import { Bot } from '../bot/Bot.js';
import { z } from 'zod';
import * as templates from '../prompts/templates.js';
import { Compiler } from '../compile/Compiler.js';
import { defaultMastra } from '../mastra.js';

export type BuildOptions = {
  url: string;
  prompt: string;
  agentOptions: AgentOptions;
};

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
      const planStep = createStep({
        id: 'plan-step',
        inputSchema: z.object({
          url: z.string(),
          goal: z.string(),
        }),
        outputSchema: z.object({
          url: z.string(),
          goal: z.string(),
          report: z.string(),
        }),
        execute: async ({ inputData }) => {
          log.info('Running report step');

          const agent = mastra.getAgentById('build-agent');
          const { url, goal } = inputData;
          const userInput = templates.userInput.render({ url, goal });
          const prompt = templates.plan.render({ userInput });
          const resp = await agent.generate(prompt);
          return {
            url,
            goal,
            report: resp.text,
          };
        },
      });

      const writeCodeStep = createStep({
        id: 'write-code-step',
        inputSchema: planStep.outputSchema,
        outputSchema: z.object({
          code: z.string(),
        }),
        execute: async ({ inputData }) => {
          log.info('Running write code step');

          const agent = mastra.getAgentById('build-agent');
          const { url, goal, report } = inputData;
          const tools = Object.fromEntries(
            Object.entries(await agent.listTools()).filter(
              ([, tool]) => !('requireApproval' in tool) || !tool.requireApproval
            )
          );
          const prompt = templates.code.render({
            toolsForCode: templates.toolsForCode.render({
              tools: JSON.stringify(tools, null, 2),
            }),
            userInput: templates.userInput.render({ url, goal }),
            report: templates.report.render({ report }),
          });
          const resp = await agent.generate(prompt);

          return {
            code: resp.text,
          };
        },
      });

      const workflow = createWorkflow({
        id: 'build-workflow',
        inputSchema: planStep.inputSchema,
        outputSchema: writeCodeStep.outputSchema,
      })
        .then(planStep)
        .then(writeCodeStep)
        .commit();

      const run = await workflow.createRun();
      const result = await run.start({
        inputData: {
          url: 'https://pokemondb.net/pokedex/pikachu',
          goal: 'Scrape pokemon names, number and move stats',
        },
      });

      if (result.status !== 'success') {
        throw new Error(`Workflow did not complete successfully: ${result.status}`);
      }

      const { code } = result.result;
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
}
