import { pick } from 'radash';
import { Redis } from 'ioredis';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
// import { ConsoleLogger } from '@mastra/core/logger';
import { ConsoleLogger } from '@mastra/core/logger';
import { type Tool, type ToolHooks } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { RedisServerCache } from '@mastra/redis';
import { LibSQLStore } from '@mastra/libsql';
import { ResponseCache, TokenLimiter, type ResponseCacheKeyInputs } from '@mastra/core/processors';
import { log } from './logger.js';
import { hash } from './util.js';
import { fetchTool, viewDocumentTool } from './tools/fetchTools.js';
import { tools as browserTools } from './tools/browserTools/index.js';
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
import { ContextCompressionProcessor } from './processors/ContextCompressionProcessor.js';

const firecrawlToolNames = new Set([
  'firecrawl_firecrawl_scrape',
  'firecrawl_firecrawl_map',
  'firecrawl_firecrawl_crawl',
  'firecrawl_firecrawl_check_crawl_status',
]);

const cacheBuster = '4';

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

  // const mcpTools = await mcpClient.listTools();
  // const rawTools: Record<string, any> = {
  //   fetchTool,
  //   viewDocumentTool,
  //   // ...Object.fromEntries(
  //   //   Object.entries(mcpTools).filter(
  //   //     ([name]) => !name.startsWith('firecrawl_') || firecrawlToolNames.has(name)
  //   //   )
  //   // ),
  // };

  // model: 'google/gemini-3.5-flash',
  // model: 'google/gemini-3.6-flash',
  // model: 'google/gemini-3.7-flash',
  const model = 'openai/gpt-5.6-luna';
  // model: 'openai/gpt-5.6-terra',
  // model: 'openai/gpt-5.6-sol',
  const inputProcessors = [
    // Compress individual page-sized tool responses first, then cap the full
    // transcript so every tool-loop iteration fits comfortably in context.
    new ContextCompressionProcessor(),
    new TokenLimiter({ limit: 200_000, trimMode: 'contiguous' }),
    new ResponseCache({
      cache,
      ttl: 3600,
      key: ({ agentId, model, prompt, stepNumber }: ResponseCacheKeyInputs) => {
        const hh = {
          cacheBuster,
          prompt: serializePrompt(prompt),
          tools: Object.entries(allTools).map(([key, tool]) =>
            [key, JSON.stringify(tool.inputSchema), JSON.stringify(tool.outputSchema)].join('')
          ),
        };
        // console.log('Hashing:', JSON.stringify(hh, null, 2));
        const h = hash(hh);
        const key = `${agentId}:${stepNumber}:${model.provider}/${model.modelId}:${h}`;
        log.info(`Response cache key: ${key}`);
        return key;
      },
    }),
  ];

  const allTools = await instrument({
    fetchTool,
    viewDocumentTool,
    ...browserTools,
  } as Record<string, any>);
  const fetchResearchTools = await instrument({
    fetchTool,
    viewDocumentTool,
  } as Record<string, any>);
  const browserResearchTools = await instrument({
    ...browserTools,
  } as Record<string, any>);

  const hooks: ToolHooks = {
    beforeToolCall: async (it) => {
      const { toolName, input, context } = it;
      const toolCallId = (context as { toolCallId: string }).toolCallId;
      log.info(`Tool start: id=${toolCallId} ${toolName}(${JSON.stringify(input)})`);
    },

    afterToolCall: async (it) => {
      const { toolName, error, context } = it;
      const toolCallId = (context as { toolCallId: string }).toolCallId;
      if (error) {
        log.error(`Tool error: id=${toolCallId} ${toolName}: ${error}`);
      } else {
        log.info(`Tool done:  id=${toolCallId} ${toolName}`);
      }
    },
  };

  const shared = {
    model,
    inputProcessors,
    hooks,
  };

  const buildAgent = new Agent({
    id: 'build-agent',
    name: 'Build Agent',
    instructions: 'You are a scraping bot builder.',
    tools: allTools,
    ...shared,
  });

  const fetchResearchAgent = new Agent({
    id: 'fetch-research-agent',
    name: 'Fetch Research Agent',
    instructions: 'You are researching how to use HTTP fetch based tools for web scraping.',
    tools: fetchResearchTools,
    ...shared,
  });

  const browserResearchAgent = new Agent({
    id: 'browser-research-agent',
    name: 'Browser Research Agent',
    instructions: 'You are researching how to use Playwright browser based tools for web scraping.',
    tools: browserResearchTools,
    ...shared,
  });

  const storage = new LibSQLStore({
    id: 'libsql-storage',
    url: 'file:./db/mastra-storage.db',
  });

  const mastra = new Mastra({
    agents: {
      buildAgent,
      fetchResearchAgent,
      browserResearchAgent,
    },
    cache,
    storage,
    backgroundTasks: {
      enabled: true,
      globalConcurrency: 20,
      perAgentConcurrency: 10,
      backpressure: 'queue',
      defaultTimeoutMs: 120_000,
    },
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

const serializePrompt = (prompt: any) => {
  const asText = prompt
    .map((message: any) => {
      try {
        const content = message.content;
        let val;
        if (typeof content == 'string') {
          val = content;
        } else if (Array.isArray(content)) {
          val = content.map((c) => {
            return pick(c as unknown as Record<string, unknown>, [
              'toolName',
              'input',
              'output',
              'type',
              'text',
            ]);
          });
        } else {
          log.error(`Unknown message type for hashing: ${content}`);

          // TODO: strict / lenient modes
          throw new Error('STOP');
          val = hash('' + Math.random());
        }
        return val;
      } catch (e) {
        console.error('Error while generating cache key:', e);
        // TODO: strict / lenient modes
        throw e;
        return hash('' + Math.random());
      }
    })
    .sort((a: any, b: any) => hash(a).localeCompare(hash(b)));
  return asText;
};

const instrument = async (rawTools: Record<string, Tool>): Promise<Record<string, Tool>> => {
  return rawTools;

  const tools: Record<string, Tool> = {};

  const instruments: Instrument[] = [
    // Cache the runtime-instrumented result to retain the original runtime metric.
    runtimeInstrument,
    // cacheInstrument,
    // concurrencyInstrument,
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
