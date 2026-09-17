import { type Tool } from '@mastra/core/tools';
import { DiskCache } from '../../cache/DiskCache.js';
import { cb } from '../../cache/busters.js';
import { toolCacheInput, toolCacheSchema } from '../../cache/toolCacheKey.js';
import { hash } from '../../util/index.js';
import { isToolFailure } from '../toolError.js';
import { addMetric } from './shared.js';
import { log } from '../../logger.js';

type CachedToolResult = { type: 'output'; output: unknown };

const cache = new DiskCache<CachedToolResult>('cacheInstrument');

export const cacheInstrument = async (tool: Tool, cacheScope = ''): Promise<Tool> => {
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }

  return {
    ...tool,
    execute: async (input, context) => {
      const key = hash({
        instrument: 'cacheInstrument',
        cacheScope,
        cacheBuster: cb.cacheInstrument,
        tool: {
          id: tool.id,
          description: tool.description,
          inputSchema: toolCacheSchema(tool.inputSchema, 'input'),
          outputSchema: toolCacheSchema(tool.outputSchema, 'output'),
          suspendSchema: toolCacheSchema(tool.suspendSchema, 'input'),
          resumeSchema: toolCacheSchema(tool.resumeSchema, 'input'),
        },
        input: toolCacheInput(input),
        context: {
          agentId: context?.agent?.agentId,
          resourceId: context?.agent?.resourceId,
          workflowId: context?.workflow?.workflowId,
          requestContext: context?.requestContext?.toJSON(),
        },
      });

      const cached = await cache.get(key);
      if (cached !== null && cached !== undefined && !isToolFailure(cached.output)) {
        log.info(`Cache hit for ${key}, tool=${tool.id}, type=${cached.type}`);
        return addCacheMetric(cached.output, 'hit', tool, context);
      }

      log.info(`Cache miss for ${key}, tool=${tool.id}`);
      let output: unknown;
      try {
        output = await execute(input, context);
      } catch (e) {
        throw e;
      }
      if (!isToolFailure(output)) {
        log.info(`Setting cache for ${key}, tool=${tool.id}`);
        await cache.set(key, { type: 'output', output });
      }
      return addCacheMetric(output, 'miss', tool, context);
    },
  };
};

const addCacheMetric = (
  output: unknown,
  result: 'hit' | 'miss',
  tool: Tool,
  context: Parameters<typeof addMetric>[4]
): Record<string, unknown> =>
  addMetric(output, 'cache', { result, originalMetrics: metricsFrom(output) }, tool, context);

const metricsFrom = (output: unknown): Record<string, unknown> => {
  if (
    typeof output !== 'object' ||
    output === null ||
    Array.isArray(output) ||
    !('instruments' in output)
  ) {
    return {};
  }

  const instruments = output.instruments;
  if (
    typeof instruments !== 'object' ||
    instruments === null ||
    Array.isArray(instruments) ||
    !('metrics' in instruments)
  ) {
    return {};
  }

  const metrics = instruments.metrics;
  return typeof metrics === 'object' && metrics !== null && !Array.isArray(metrics)
    ? { ...metrics }
    : {};
};
