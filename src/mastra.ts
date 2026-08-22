import chalk from 'chalk';
import { pick } from 'radash';
import { Redis } from 'ioredis';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { InMemoryServerCache } from '@mastra/core/cache';
import { ConsoleLogger } from '@mastra/core/logger';
import { type ToolHooks } from '@mastra/core/tools';
import { RedisServerCache } from '@mastra/redis';
import { LibSQLStore } from '@mastra/libsql';
import { TokenLimiter, type ResponseCacheKeyInputs } from '@mastra/core/processors';
import { log } from './logger.js';
import { getOrNull, hash } from './util/index.js';
import { cb } from './cache/busters.js';
import {
  isMastraPlatform,
  redisCacheUrl,
  sqliteDbUrl,
  tursoAuthToken,
  tursoDatabaseUrl,
} from './constants.js';
import { tools as fetchTools } from './tools/fetchTools/index.js';
import { tools as browserTools } from './tools/browserTools/index.js';
import { tools as codeTools } from './tools/codeTools/index.js';
import { tools as documentTools } from './tools/documents/index.js';
import { createTools as createBrightdataTools } from './tools/brightdataTools/index.js';
import { createTools as createFirecrawlTools } from './tools/firecrawlTools/index.js';
import { createTools as createScrapingbeeTools } from './tools/scrapingbeeTools/index.js';
import { ContextCompressionProcessor } from './processors/ContextCompressionProcessor.js';
import {
  LoggingResponseCache,
  ResponseLoggingProcessor,
} from './processors/ResponseLoggingProcessor.js';

export const defaultMastra = async (): Promise<{
  mastra: Mastra;
  cleanup: () => Promise<void>;
}> => {
  if (isMastraPlatform && !tursoDatabaseUrl) {
    throw new Error('TURSO_DATABASE_URL must be set for a Mastra Platform deployment.');
  }

  const redisClient = redisCacheUrl ? new Redis(redisCacheUrl) : null;
  const cache = redisClient
    ? new RedisServerCache({ client: redisClient }, { keyPrefix: 'cb:' + cb.global + ':' })
    : new InMemoryServerCache();

  const [
    brightdataTools,
    // firecrawlTools,
    scrapingbeeTools,
  ] = await Promise.all([
    createBrightdataTools(),
    // createFirecrawlTools(),
    createScrapingbeeTools(),
  ]);

  // model: 'google/gemini-3.5-flash',
  // model: 'google/gemini-3.6-flash',
  // model: 'google/gemini-3.7-flash',
  // const model = 'openai/gpt-5.6-luna';
  const model = 'openai/gpt-5.6-terra';
  // model: 'openai/gpt-5.6-sol',
  const responseLogger = new ResponseLoggingProcessor();
  const inputProcessors = [
    // Compress individual page-sized tool responses first, then cap the full
    // transcript so every tool-loop iteration fits comfortably in context.
    new ContextCompressionProcessor(),
    new TokenLimiter({ limit: 400_000, trimMode: 'contiguous' }),
    responseLogger,
    new LoggingResponseCache(
      {
        cache,
        ttl: 3600,
        key: ({ agentId, model, prompt, stepNumber }: ResponseCacheKeyInputs) => {
          const h = hash({
            cacheBuster: cb.mastraResponse,
            prompt: serializePrompt(prompt),
            tools: Object.entries(allTools).map(([key, tool]) =>
              [key, JSON.stringify(tool.inputSchema), JSON.stringify(tool.outputSchema)].join('')
            ),
          });
          const key = `${agentId}:${stepNumber}:${model.provider}/${model.modelId}:${h}`;
          log.info(`Response cache key: ${key}`);
          return key;
        },
      },
      responseLogger
    ),
  ];
  // const outputProcessors = [
  //   new ResponseLoggingProcessor(),
  // ];

  const allTools = {
    ...fetchTools,
    ...browserTools,
    ...codeTools,
    ...documentTools,
    ...brightdataTools,
    // ...firecrawlTools,
    ...scrapingbeeTools,
  };
  const fetchResearchTools = {
    ...fetchTools,
    ...codeTools,
    ...documentTools,
  };
  const browserResearchTools = {
    ...browserTools,
    ...codeTools,
    ...documentTools,
  };

  const hooks: ToolHooks = {
    beforeToolCall: async (it) => {
      const { toolName, input, context } = it;
      const toolCallId = (context as { toolCallId: string }).toolCallId;
      log.info(`Tool start: id=${toolCallId} ${toolName}(${JSON.stringify(input)})`);
    },

    afterToolCall: async (it) => {
      const { toolName, error, output, context } = it;
      const toolCallId = (context as { toolCallId: string }).toolCallId;
      // console.log('afterToolCall it:', it);
      if (error) {
        log.error(`${chalk.bgRed('Tool error')} id=${toolCallId} ${toolName}: ${error}`);
      } else {
        log.info(`Tool done:  id=${toolCallId} ${toolName}`);
      }

      const maxLines = 20;
      const maxWidth = 100;
      const clipLine = (line: string) =>
        line.length > maxWidth ? `${line.slice(0, maxWidth - 3)}...` : line;
      const logOmittedLines = (lineCount: number) => {
        const omitted = lineCount - maxLines;
        return omitted > 0 ? `\t${chalk.dim(`Omitted ${omitted} lines`)}` : null;
      };
      const content = getOrNull<unknown>(output, 'content');
      const full =
        typeof content === 'string' ? content : (JSON.stringify(output, null, 2) ?? String(output));
      const lines = full.split('\n');
      const url = getOrNull<string>(output, 'url');
      const preview = [
        `\t${toolName}`,
        ...(url ? [`\t${chalk.bold.yellow(url)}`] : []),
        ...lines
          .slice(0, maxLines)
          .map((line, i) => `\t${chalk.dim(String(i + 1).padStart(2))} ${clipLine(line)}`),
        logOmittedLines(lines.length),
      ]
        .filter((line): line is string => line !== null)
        .join('\n');
      log.info(`Tool output preview:\n\n${preview}\n\n`);
    },
  };

  const shared = {
    model,
    inputProcessors,
    hooks,
    providerOptions: {
      openai: {
        reasoningEffort: 'medium',
        reasoningSummary: 'detailed',
      },
    },
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
    url: sqliteDbUrl,
    authToken: tursoAuthToken,
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
    await Promise.all([mastra.shutdown(), ...(redisClient ? [redisClient.disconnect()] : [])]);
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
            const clean = pick({ ...c } as unknown as Record<string, unknown>, [
              'toolName',
              'input',
              'output',
              'type',
              'text',
            ]);

            if ((clean as any).output?.value?.instruments) {
              log.debug('Removing instruments data for cache key');
              delete (clean as any).output.value.instruments;
            }
            if ((clean as any).output?.instruments) {
              log.debug('Removing instruments data for cache key');
              delete (clean as any).output.instruments;
            }

            return clean;
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
