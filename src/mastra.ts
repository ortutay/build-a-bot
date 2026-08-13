import { pick } from 'radash';
import { Redis } from 'ioredis';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { ConsoleLogger } from '@mastra/core/logger';
import { MCPClient } from '@mastra/mcp';
import { RedisServerCache } from '@mastra/redis';
import { LibSQLStore } from '@mastra/libsql';
import { ResponseCache, type ResponseCacheKeyInputs } from '@mastra/core/processors';
import { log } from './logger.js';
import { hash } from './util.js';
import { fetchTool, viewDocumentTool } from './tools/fetchTool.js';
import { brightdataApiKey, firecrawlApiKey } from './constants.js';

console.log('firecrawlApiKey', firecrawlApiKey);

export const defaultMastra = async (): Promise<{
  mastra: Mastra;
  cleanup: () => Promise<void>;
}> => {
  const redisClient = new Redis('redis://localhost:54321');
  const cache = new RedisServerCache({
    client: redisClient,
  });

  const mcpClient = new MCPClient({
    id: 'mcp-client',
    servers: {
      brightdata: {
        url: new URL(`https://mcp.brightdata.com/mcp?token=${brightdataApiKey}`),
      },
      firecrawl: {
        url: new URL(`https://mcp.firecrawl.dev/${firecrawlApiKey}/v2/mcp`),
      },
      // scrapingbee: {
      //   url: new URL(
      //     `https://mcp.scrapingbee.com/mcp?api_key=${scrapingbeeApiKey}`
      //   ),
      // },
    },
  });

  const rawTools = {
    fetchTool,
    viewDocumentTool,
    ...(await mcpClient.listTools()),
  };
  const tools = {};
  for (const [name, tool] of Object.entries(rawTools)) {
    tools[name] = {
      ...tool,
      execute: async (...args) => {
        const start = new Date().getTime();
        const out = await tool.execute(...args);
        const runtime = new Date().getTime() - start;
        console.log('runtime:', runtime);
        return { output: out, metadata: { runtime } };
      },

      // toModelOutput: (it: any) => {
      //   // console.log('toModelOutput:', name, it);
      //   return {
      //     type: 'json',
      //     value: it,
      //   }
      // }
    };
  }

  const buildAgent = new Agent({
    id: 'build-agent',
    name: 'Build Agent',
    instructions: 'You are a scraping bot builder.',
    model: 'openai/gpt-5.6-luna',
    tools,
    inputProcessors: [
      new ResponseCache({
        cache,
        ttl: 3600,
        key: ({ agentId, model, prompt, stepNumber }: ResponseCacheKeyInputs) => {
          const h = hash({
            prompt: hashPrompt(prompt),
            tools: Object.keys(tools),
          });
          const key = `${agentId}:${stepNumber}:${JSON.stringify(model)}:${h}`;
          log.info(`Cache key: ${key}`);
          return key;
        },
      }),
    ],

    hooks: {
      beforeToolCall: (it) => {
        // console.log('Before it:', it);
        const {
          toolName,
          input,
          context: { toolCallId },
        } = it;
        log.info(`Tool start: id=${toolCallId} ${toolName}(${JSON.stringify(input)})`);
      },

      afterToolCall: (it) => {
        // console.log('After it:', it);
        const {
          toolName,
          error,
          context: { toolCallId },
        } = it;
        if (error) {
          log.error(`Tool error: id=${toolCallId} ${toolName}: ${error}`);
        } else {
          log.info(`Tool done:  id=${toolCallId} ${toolName}`);
        }
      },
    },
  });

  const storage = new LibSQLStore({
    id: 'libsql-storage',
    url: 'file:./db/mastra-storage.db',
  });

  const mastra = new Mastra({
    agents: { buildAgent },
    cache,
    storage,
    logger: new ConsoleLogger({
      level: 'debug',
      filter: (it) => {
        // console.log('IT:', it);
      },
    }),
  });

  const cleanup = async () => {
    await Promise.all([mcpClient.disconnect(), mastra.shutdown(), redisClient.disconnect()]);
  };

  return { mastra, cleanup };
};

const hashPrompt = (prompt: any) => {
  const asText = prompt
    .map((message: any) => {
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
    .sort((a: any, b: any) => hash(a).localeCompare(hash(b)));
  return hash(asText);
};
