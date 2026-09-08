import { type Tool } from '@mastra/core/tools';
import { DiskCache } from '../../cache/DiskCache.js';
import { cb } from '../../cache/busters.js';
import { hash } from '../../util/index.js';
import { addMetric, asJSONSchema } from './shared.js';
import { log } from '../../logger.js';

type CachedToolResult = { type: 'output'; output: unknown };

const cache = new DiskCache<CachedToolResult>('cacheInstrument');

export const cacheInstrument = async (tool: Tool): Promise<Tool> => {
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }

  return {
    ...tool,
    execute: async (input, context) => {
      const key = hash({
        instrument: 'cacheInstrument',
        cacheBuster: cb.cacheInstrument,
        tool: {
          id: tool.id,
          description: tool.description,
          inputSchema: tool.inputSchema && asJSONSchema(tool.inputSchema, 'input'),
          outputSchema: tool.outputSchema && asJSONSchema(tool.outputSchema, 'output'),
          suspendSchema: tool.suspendSchema && asJSONSchema(tool.suspendSchema, 'input'),
          resumeSchema: tool.resumeSchema && asJSONSchema(tool.resumeSchema, 'input'),
        },
        input,
        context: {
          agentId: context?.agent?.agentId,
          resourceId: context?.agent?.resourceId,
          workflowId: context?.workflow?.workflowId,
          requestContext: context?.requestContext?.toJSON(),
        },
      });

      const cached = await cache.get(key);
      if (cached !== null && cached !== undefined) {
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
      log.info(`Setting cache for ${key}, tool=${tool.id}`);
      await cache.set(key, { type: 'output', output });
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
