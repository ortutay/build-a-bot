import { pick } from 'radash';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { ConsoleLogger } from '@mastra/core/logger';
import { Mastra } from '@mastra/core';
import {
  ResponseCache,
  type ResponseCacheKeyInputs,
} from '@mastra/core/processors';
import { RedisServerCache } from '@mastra/redis';
import { MCPClient } from '@mastra/mcp';

import { hash } from './util.js';
import { Compiler } from './compile/Compiler.js';
import { fetchTool, viewDocumentTool } from './tools/fetchTool.js';
import {
  brightdataApiKey,
  firecrawlApiKey,
  scrapingbeeApiKey,
} from './constants.js';

import { Workshop } from './index.js';

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
  console.log('main');

  const ws = new Workshop();
  const bot = await ws.build({ ...target, agentOptions: {} });

  console.log('Got bot:', bot);
};

const main0 = async () => {
  const cache = new RedisServerCache({
    client: new Redis('redis://localhost:54321'),
  });

  const mcpClient = new MCPClient({
    id: 'mcp-client',
    servers: {
      brightdata: {
        url: new URL(
          `https://mcp.brightdata.com/mcp?token=${brightdataApiKey}`
        ),
      },
      // firecrawl: {
      //   url: new URL(`https://mcp.firecrawl.dev/${firecrawlApiKey}/v2/mcp`),
      // },
      scrapingbee: {
        url: new URL(
          `https://mcp.scrapingbee.com/mcp?api_key=${scrapingbeeApiKey}`
        ),
      },
    },
  });
  const mcpTools = await mcpClient.listTools();
  console.log('mcpTools:', mcpTools);

  const testAgent = new Agent({
    id: 'test-agent',
    name: 'Test Agent',
    instructions: 'You are a helpful assistant.',
    model: 'openai/gpt-5.6-luna',
    tools: {
      fetchTool,
      viewDocumentTool,
      ...mcpTools,
    },
    inputProcessors: [
      new ResponseCache({
        cache,
        ttl: 3600,
        key: ({
          agentId,
          scope,
          model,
          prompt,
          stepNumber,
        }: ResponseCacheKeyInputs) => {
          const asText = prompt
            .map((message) => {
              try {
                const content = message.content;
                let val;
                if (typeof content == 'string') {
                  val = content;
                } else if (Array.isArray(content)) {
                  val = content.map((c) =>
                    pick(c as unknown as Record<string, unknown>, [
                      'toolName',
                      'input',
                      'output',
                      'type',
                      'text',
                    ])
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
            })
            .sort((a, b) => hash(a).localeCompare(hash(b)));

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
        ['AGENT', 'TOOL', 'MCP'].includes(component as string),
    }),
  });

  const userInputPrompt = ({
    url,
    goal,
  }: {
    url: string;
    goal: string;
  }) => `<user-input>
  <user-url>${url}</user-url>
  <user-goal>${goal}</user-goal>
</user-input>`;

  const reportPrompt = ({ report }: { report: string }) => `<report>
${report}
</report>`;

  const toolsForCodePrompt = ({
    tools,
  }: {
    tools: unknown;
  }) => `<tool-instructions>
You have helper functions available, based on the tools below. You can call any of these tools like this:

    const output = await tools.toolNameHere({ ...tool input here... });

The tool name is its key in the mapping.

For example, if a tool has the key "weatherTool", call it like this:
    
    const output = await tools.weatherTool({ city: "New York City, NY' });

Tools:

<tool-list>
${JSON.stringify(tools, null, 2)}
</tool-list>

</tools-instructions>`;

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
      const agent = mastra.getAgentById('test-agent');
      const { url, goal } = inputData;
      const prompt = `You are writing a JavaScript web scraping script. Explore and gather information necessary to write this script.

Do not write code yet, simple generate a written report about how to run the script once you have enough information.

Guidelines:
- When code will operate on multiple pages, inspect at least two examples to confirm reusable selectors.
- If the task is impossible, explain why and stop.
- If necessary, navigate around the site to find the right target page(s) for extraction.

# Specifics and evidence

Include specifics in your report, including:
- Sample URLs
- Sample HTML snippets from those URLs
- Any other specifics that will be helpful for the coding agent

# Input and ouput schema

Define an input and output schema for this function. It should be a reusable, paramaterized function. It will be part of HTTP API endpoint, so the input should be a JSON object, mostly strings or numbers as values.

The schemas should follow JSON schema conventions. A full valid example is below:

  const outputSchema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            number: { type: "string" }
          }
        }
      }
    }
  }

Guidelines for input schema:
- It should more resemble an HTTP API, rather than a scraping endpoint. That means the parameters may not be URLs
- Base the input on the user prompt, and also on the general site layout. For example, if you have something like https://www.example.com/category/product, perhaps "category" can be a parameters
- Make it permissive. Unless necessary, make inputs optional.

Guidelines for output schema:
- Follow the user prompt
- Beyond that, give a nicely structured output with the key data
- Make it resilient. Unless absolutely necessary, make outputs optional.

${userInputPrompt({ url, goal })}
`;

      console.log('Plan Prompt:', prompt);

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
      const agent = mastra.getAgentById('test-agent');
      const { url, goal, report } = inputData;
      const tools = await agent.listTools();
      // TODO: filter tools list appropriately, for example, do not include tools that require approval

      const prompt = `You are writing a JavaScript web scraping script. You have various reports from sub-agents. Use these to write reports.

If necessary, use tools load pages and inspect the site further to generate the script.

Guidelines for input and output:
- If you are returning a list of results:
  - Include the following inputs, in addition to domain specific ones:
    - limit: Max number of results, default 1000
    - offset: Starting offset, combines with limit
  - Use the following output format:
    - results: Array of results items
    - total: total number of results
    - count: number of results in the current result set
- If you are returning a single result:
  - Simply return the object itself
- Input schema:
  - Make it permissive. Unless necessary, make inputs optional.
  - Avoid putting the input URL as one of the fields in input schema. You can instead hardcode it, with the option to override if necessary.
  - Do not put default values on filter fields, or most other fields.
    - For example, a list endpoint should, by default, return everything, and filters should not have pre-defined defaults
  - For detail getter endpoints, the idenitifer can be required
    - For example, for https://example.com/products/:id, the :id field should be required
- Output schema:
  - Make it resilient. Unless absolutely necessary, make outputs optional.

# Structure

Your code must be structured in the following way:

  export const inputSchema = { /* ... JSON schema ...*/ };
  export const outputSchema = { /* ... JSON schema ...*/ };
  export const exampleInput = { /* ... JSON object that fits the input schema ...*/ };
  export const run = async (input) => {
    return { ... }
  }

The process that loads your code expects this format, with these exact names.


${toolsForCodePrompt({ tools })}

# Dependencies

Do not use any dependencies, not even fetch(). Use the tools above instead.

# Guidelines

- Because you have availableModules, do not write any "import" lines.
- Do not attempt to spoof User Agents, etc. That will be handled elsewhere.

${userInputPrompt({ url, goal })}

${reportPrompt({ report })}
`;
      const resp = await agent.generate(prompt);

      return {
        code: resp.text,
      };
    },
  });

  // const step3 = createStep({
  //   id: 'step-3',
  //   inputSchema: z.object({
  //     code: z.string(),
  //     // url: z.string(),
  //     // goal: z.string(),
  //   }),
  //   outputSchema: z.object({
  //     // url: z.string(),
  //     // goal: z.string(),
  //     // report: z.string(),
  //   }),
  //   execute: async ({ inputData }) => {
  //   },
  // });

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
      url: 'https://pokemondb.net/pokedex/pikachu',
      goal: 'Scrape pokemon names, number and move stats',
    },
  });

  const compiler = new Compiler();

  if (result.status !== 'success') {
    throw new Error(`Workflow did not complete successfully: ${result.status}`);
  }

  const { code } = result.result;
  console.log('Got result:', code);
  const out = await compiler.compile(code, mastra.getAgentById('test-agent'));

  console.log('Compiled input schema:', out.inputSchema);
  console.log('Compiled output schema:', out.outputSchema);
  console.log('Compiled example input:', out.exampleInput);

  const out2 = await out.fn(out.exampleInput);
  console.log('out2:', out2);

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
