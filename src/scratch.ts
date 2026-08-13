import { pick } from 'radash';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { ConsoleLogger } from '@mastra/core/logger';
import { Mastra } from '@mastra/core';
import { ResponseCache } from '@mastra/core/processors';
import { RedisServerCache } from '@mastra/redis';
import { hash } from './util.js';
import Redis from 'ioredis';
import { z } from 'zod';

import { fetchTool, viewDocumentTool } from './tools/fetchTool.js';

// import { Workshop } from './index.js';
// import { Agent } from './agent/Agent.js';
// import { fetchTool, jsFetchTool } from './tools/index.js';

const target = {
  url: 'https://pokemondb.net/pokedex/national',
  prompt: ' pokemon: name, number, and basic stats including HP',
};

// const target = {
//   url: "https://uk.rubix.com/en/adhesive-tapes/c-50-15-20",
//   prompt:
//     "Scrape all tape products: EUR price, dimensions, and other standard details.",
// };

const main = async () => {
  const cache = new RedisServerCache({
    client: new Redis('redis://localhost:54321'),
  });

  const testAgent = new Agent({
    id: 'test-agent',
    name: 'Test Agent',
    instructions: 'You are a helpful assistant.',
    model: 'openai/gpt-5.6-luna',
    tools: { fetchTool, viewDocumentTool },
    inputProcessors: [
      new ResponseCache({
        cache,
        ttl: 3600,
        key: ({ agentId, scope, model, prompt, stepNumber }) => {
          const asText = prompt.map((message) => {
            try {
              const content = message.content;
              let val;
              if (typeof content == 'string') {
                val = content;
              } else if (Array.isArray(content)) {
                val = content.map((c) =>
                  pick(c, ['toolName', 'input', 'output', 'type', 'text'])
                );
              } else {
                val = hash('' + Math.random());
              }
              // console.log('val:', val);
              return val;
            } catch (e) {
              console.error('Error while generating cache key:', e);
              return hash('' + Math.random());
            }
          });

          const key = hash([
            agentId,
            stepNumber,
            // TODO: More robust cache key construction
            asText,
          ]);
          console.log('key', stepNumber, key);
          return key;
        },
      }),
    ],

    hooks: {
      beforeToolCall: ({ toolName, input }) => {
        console.info(`[tool:start] ${toolName}(${JSON.stringify(input)})`);
      },

      afterToolCall: ({ toolName, output, error }) => {
        if (error) {
          console.error('[tool:error]', { toolName, error });
        } else {
          console.info(`[tool:done]  ${toolName}`);
        }
      },
    },
  });

  const mastra = new Mastra({
    agents: { testAgent },
    cache,
    logger: new ConsoleLogger({
      level: 'debug',
      filter: ({ component }) =>
        component === 'AGENT' || component === 'TOOL' || component === 'MCP',
    }),
  });

  const agent = mastra.getAgentById('test-agent');

  const userInputPrompt = ({ url, goal }) => `<user-input>
  <user-url>${url}</user-url>
  <user-goal>${goal}</user-goal>
</user-input>`;

  const reportPrompt = ({ report }) => `<report>
${report}
</report>`;

  const step1 = createStep({
    id: 'step-1',
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
      console.log('Report step');

      const testAgent = mastra.getAgentById('test-agent');
      const { url, goal } = inputData;
      const prompt = `You are in step 1 of scraping, the planning stage. Plan out out how to complete the following scrape:

${userInputPrompt({ url, goal })}

Explore the site before giving your answer.
`;

      // console.log('Prompt:', prompt);

      const resp = await agent.generate(prompt);
      return {
        url,
        goal,
        report: resp.text,
      };
    },
  });

  const step2 = createStep({
    id: 'step-2',
    inputSchema: z.object({
      url: z.string(),
      goal: z.string(),
      report: z.string(),
    }),
    outputSchema: z.object({
      code: z.string(),
    }),
    execute: async ({ inputData }) => {
      console.log('Write code step');
      const { url, goal, report } = inputData;
      // console.log('Got report:', report);

      const prompt = `yyy You have a report from an AI Agent on how to fulfill a user scraping request. Use this report to generate a Javascript scraping script. x

${userInputPrompt({ url, goal })}
${reportPrompt({ report })}

Return a Javascript script`;
      const resp = await agent.generate(prompt);

      // console.log('RESP:', resp);

      return {
        code: resp.text,
      };
    },
  });

  const testWorkflow = createWorkflow({
    id: 'test-workflow',
    inputSchema: z.object({
      url: z.string(),
      goal: z.string(),
    }),
    outputSchema: z.object({
      code: z.string(),
    }),
  })
    .then(step1)
    .then(step2)
    .commit();

  const run = await testWorkflow.createRun();

  const result = await run.start({
    inputData: {
      url: 'https://pokemondb.net/pokedex/national',
      goal: 'Scrape pokemon names, numbers, and all moves with associated move data',
    },
  });

  console.log('Got result:', result.result.code);

  // const response = await agent.generate('Get HTML for example.com');
  // console.log(response.text);

  // console.log('main', target);
  // const ws = new Workshop();
  // const bot = await ws.build({
  //   ...target,
  //   agentOptions: {
  //     model: 'google/gemini-3.5-flash-lite',
  //     tools: [
  //       // fetchTool,
  //       jsFetchTool,
  //     ],
  //   },
  // });

  return;

  // console.log('got bot:', bot);

  // const { fn, code, usage } = await build(target);
  // const out = await fn({});
  // console.log('Code:', code);
  // console.log('Usage:', usage);
  // console.log('Out:', out);
  // const { content, usage } = await run.runFull(target);
  // const out = await execute(content, {});
  // console.log('Out:', out);
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
