import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { ConsoleLogger } from '@mastra/core/logger';
import { TokenLimiter, type ResponseCacheKeyInputs } from '@mastra/core/processors';
import { MastraCompositeStore } from '@mastra/core/storage';
import { type ToolHooks } from '@mastra/core/tools';
import { LibSQLStore } from '@mastra/libsql';
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from '@mastra/observability';
import { RedisServerCache } from '@mastra/redis';
import chalk from 'chalk';
import { Redis } from 'ioredis';
import { cb } from '../cache/busters.js';
import { responseCacheHashInput } from '../cache/responseCacheKey.js';
import { toolCacheSchema } from '../cache/toolCacheKey.js';
import {
  mastraDatabaseFilepath,
  redisCacheUrl,
  tursoAuthToken,
  tursoDatabaseUrl,
} from '../constants.js';
import type { GlobalContext } from '../context/index.js';
import { log } from '../logger.js';
import { getOrNull, hash } from '../util/index.js';
import { DiskServerCache } from './extensions/cache/DiskServerCache.js';
import { ContextCompressionProcessor } from './processors/ContextCompressionProcessor.js';
import {
  LoggingResponseCache,
  ResponseLoggingProcessor,
} from './processors/ResponseLoggingProcessor.js';
import { createBuildScorer } from './scorers/index.js';
import { closeTools, createToolsSets } from './tools/index.js';
import { planWorkflow, writeWorkflow, healWorkflow } from './workflows/index.js';

export type MastraOptions = Pick<
  GlobalContext,
  'browserSession' | 'documentLibrary' | 'proxyRegistry'
>;

export const defaultMastra = async (
  options: MastraOptions
): Promise<{
  mastra: Mastra;
  cleanup: (context: GlobalContext) => Promise<void>;
}> => {
  const { allTools, fetchResearchTools, browserResearchTools, planningTools } =
    await createToolsSets(options);
  const redisClient = redisCacheUrl ? new Redis(redisCacheUrl) : null;
  if (!redisClient) {
    log.info('No Redis client, using disk cache');
  }
  const cache = redisClient
    ? new RedisServerCache(
        { client: redisClient },
        { keyPrefix: 'cb:' + cb.mastraResponseCache + ':' }
      )
    : new DiskServerCache({ keyPrefix: 'cb:' + cb.mastraResponseCache + ':' });

  // const model = 'openai/gpt-5.6-terra';
  const model = 'openai/gpt-5.6-sol';

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
          const hh = responseCacheHashInput({
            cacheBuster: cb.mastraResponse,
            prompt,
            tools: Object.entries(allTools).map(([key, tool]) =>
              [
                key,
                JSON.stringify(toolCacheSchema(tool.inputSchema, 'input')),
                JSON.stringify(toolCacheSchema(tool.outputSchema, 'output')),
              ].join('')
            ),
          });
          const h = hash(hh);
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

  const hooks: ToolHooks = {
    beforeToolCall: async (it) => {
      const { toolName, input, context } = it;
      const toolCallId = (context as { toolCallId: string }).toolCallId;
      log.info(`Tool start: id=${toolCallId} ${toolName}(${JSON.stringify(input)})`);
    },

    afterToolCall: async (it) => {
      const { toolName, error, output, context } = it;
      const toolCallId = (context as { toolCallId: string }).toolCallId;
      if (error) {
        log.error(
          `${chalk.bgRed('Tool error')} id=${toolCallId} ${chalk.bold.cyanBright(toolName)}: ${error}`
        );
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

  const planningAgent = new Agent({
    id: 'planning-agent',
    name: 'Planning Agent',
    instructions: 'You are a planning a scraping bot.',
    tools: planningTools,
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

  const storage = new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'libsql-storage',
      url: tursoDatabaseUrl ?? mastraDatabaseFilepath,
      ...(tursoDatabaseUrl && tursoAuthToken ? { authToken: tursoAuthToken } : {}),
    }),
  });

  const observability = new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          // Persists observability events to Mastra Storage
          new MastraStorageExporter(),
          // Sends observability events to Mastra platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
          new MastraPlatformExporter(),
        ],
        spanOutputProcessors: [
          // Redacts sensitive data like passwords, tokens, keys
          new SensitiveDataFilter(),
        ],
        logging: {
          enabled: true,
          level: 'info',
        },
      },
    },
  });

  const mastra = new Mastra({
    tools: allTools,
    agents: {
      buildAgent,
      planningAgent,
      fetchResearchAgent,
      browserResearchAgent,
    },
    workflows: {
      planWorkflow,
      writeWorkflow,
      healWorkflow,
    },
    cache,
    storage,
    observability,
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

  mastra.addScorer(createBuildScorer(mastra));

  let cleanupPromise: Promise<void> | undefined;
  const cleanup = (context: GlobalContext): Promise<void> => {
    cleanupPromise ??= (async () => {
      const errors: unknown[] = [];
      // Stop work before closing the resources used by that work. Try every phase.
      for (const close of [
        () => mastra.shutdown(),
        () => closeTools(context),
        () => redisClient?.disconnect(),
      ]) {
        try {
          await close();
        } catch (e) {
          errors.push(e);
        }
      }
      if (errors.length) {
        throw new AggregateError(errors, 'Failed to clean up Mastra');
      }
    })();
    return cleanupPromise;
  };

  return { mastra, cleanup };
};
