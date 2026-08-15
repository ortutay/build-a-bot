import * as z from 'zod';
import { standardSchemaToJSONSchema, type StandardSchemaWithJSON } from '@mastra/core/schema';
import type { ToolExecutionContext, Tool } from '@mastra/core/tools';
import { log } from '../logger.js';

export const addMetric = (
  output: unknown,
  field: string,
  value: unknown,
  tool: Tool,
  context: ToolExecutionContext
): Record<string, unknown> => {
  log.info(`Add metric for ${tool.id}: ${field}=${JSON.stringify(value)}`);

  if (
    typeof output !== 'object' ||
    output === null ||
    Array.isArray(output) ||
    !('metrics' in output)
  ) {
    return {
      output,
      metrics: { [field]: value },
    };
  }

  const result = output as Record<string, unknown>;
  const metrics = result.metrics;
  if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) {
    throw new Error('unexpected');
  }
  (metrics as Record<string, unknown>)[field] = value;
  return result;
};

export const asJSONSchema = (
  schema: StandardSchemaWithJSON,
  io: 'input' | 'output'
): Parameters<typeof z.fromJSONSchema>[0] => {
  return standardSchemaToJSONSchema(schema, { io }) as Parameters<typeof z.fromJSONSchema>[0];
};
