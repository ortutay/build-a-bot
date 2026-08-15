import { pick } from 'radash';
import { Redis } from 'ioredis';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { ConsoleLogger } from '@mastra/core/logger';
import { type Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { RedisServerCache } from '@mastra/redis';
import { LibSQLStore } from '@mastra/libsql';
import { ResponseCache, type ResponseCacheKeyInputs } from '@mastra/core/processors';
import { log } from './logger.js';
import { hash } from './util.js';
import { fetchTool, viewDocumentTool } from './tools/fetchTool.js';
import {
  runtimeInstrument,
  cacheInstrument,
  concurrencyInstrument,
  brightdataCostInstrument,
  firecrawlCostInstrument,
  scrapingbeeCostInstrument,
  type Instrument,
} from './instruments/index.js';
import { brightdataApiKey, firecrawlApiKey, scrapingbeeApiKey } from './constants.js';

const firecrawlToolNames = new Set([
  'firecrawl_firecrawl_scrape',
  'firecrawl_firecrawl_map',
  'firecrawl_firecrawl_crawl',
  'firecrawl_firecrawl_check_crawl_status',
]);

const cacheBuster = '3';

export const defaultMastra = async (): Promise<{
  mastra: Mastra;
  cleanup: () => Promise<void>;
}> => {
  const redisClient = new Redis('redis://localhost:54321');
  const cache = new RedisServerCache(
    { client: redisClient },
    { keyPrefix: 'cb:' + cacheBuster + ':' }
  );
  // const cache = null;

  const mcpClient = new MCPClient({
    id: 'mcp-client',
    servers: {
      brightdata: {
        url: new URL(`https://mcp.brightdata.com/mcp?token=${brightdataApiKey}`),
      },
      firecrawl: {
        url: new URL(`https://mcp.firecrawl.dev/${firecrawlApiKey}/v2/mcp`),
      },
      scrapingbee: {
        url: new URL(`https://mcp.scrapingbee.com/mcp?api_key=${scrapingbeeApiKey}`),
      },
    },
  });

  const mcpTools = await mcpClient.listTools();
  const rawTools: Record<string, any> = {
    fetchTool,
    viewDocumentTool,
    ...Object.fromEntries(
      Object.entries(mcpTools).filter(
        ([name]) => !name.startsWith('firecrawl_') || firecrawlToolNames.has(name)
      )
    ),
  };
  const tools = await instrument(rawTools);

  const buildAgent = new Agent({
    id: 'build-agent',
    name: 'Build Agent',
    instructions: 'You are a scraping bot builder.',
    model: 'openai/gpt-5.6-luna',
    // model: 'openai/gpt-5.6-terra',
    tools,
    inputProcessors: [
      new ResponseCache({
        cache,
        ttl: 3600,
        key: ({ agentId, model, prompt, stepNumber }: ResponseCacheKeyInputs) => {
          const hh = {
            prompt: hashPrompt(prompt),
            tools: Object.entries(tools).map(([key, tool]) =>
              [key, JSON.stringify(tool.inputSchema), JSON.stringify(tool.outputSchema)].join('')
            ),
          };
          // console.log('Hashing:', hh);
          const h = hash(hh);
          const key = `${agentId}:${stepNumber}:${JSON.stringify(model)}:${h}`;
          log.info(`Cache key: ${key}`);
          return key;
        },
      }),
    ],

    hooks: {
      beforeToolCall: (it) => {
        const { toolName, input, context } = it;
        const toolCallId = (context as { toolCallId: string }).toolCallId;
        log.info(`Tool start: id=${toolCallId} ${toolName}(${JSON.stringify(input)})`);
      },

      afterToolCall: (it) => {
        const { toolName, error, context } = it;
        const toolCallId = (context as { toolCallId: string }).toolCallId;
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
      level: 'info',
      filter: () => true,
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
        return val;
      } catch (e) {
        console.error('Error while generating cache key:', e);
        return hash('' + Math.random());
      }
    })
    .sort((a: any, b: any) => hash(a).localeCompare(hash(b)));
  return hash(asText);
};

const instrument = async (rawTools: Record<string, Tool>): Promise<Record<string, Tool>> => {
  const tools: Record<string, Tool> = {};

  const instruments: Instrument[] = [
    // Cache the runtime-instrumented result to retain the original runtime metric.
    runtimeInstrument,
    cacheInstrument,
    concurrencyInstrument,
    firecrawlCostInstrument,
    brightdataCostInstrument,
    scrapingbeeCostInstrument,
  ];

  for (const [name, tool] of Object.entries(rawTools)) {
    tools[name] = tool;
  }

  for (const instrument of instruments) {
    for (const [name, tool] of Object.entries(tools)) {
      tools[name] = await instrument(tool);
    }
  }

  return tools;
};
