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

  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    throw new Error(`Cannot add instrument metrics to non-object output from ${tool.id}`);
  }

  const result = output as Record<string, unknown>;
  const instruments = result.instruments;
  if (instruments !== undefined && (typeof instruments !== 'object' || instruments === null)) {
    throw new Error(`Invalid instruments output from ${tool.id}`);
  }
  const instrumentMetrics =
    instruments && 'metrics' in instruments
      ? (instruments as Record<string, unknown>).metrics
      : undefined;
  if (
    instrumentMetrics !== undefined &&
    (typeof instrumentMetrics !== 'object' ||
      instrumentMetrics === null ||
      Array.isArray(instrumentMetrics))
  ) {
    throw new Error(`Invalid instrument metrics output from ${tool.id}`);
  }

  return {
    ...result,
    instruments: {
      ...(instruments as Record<string, unknown> | undefined),
      metrics: {
        ...(instrumentMetrics as Record<string, unknown> | undefined),
        [field]: value,
      },
    },
  };
};

export const asJSONSchema = (
  schema: StandardSchemaWithJSON,
  io: 'input' | 'output'
): Parameters<typeof z.fromJSONSchema>[0] => {
  return standardSchemaToJSONSchema(schema, { io }) as Parameters<typeof z.fromJSONSchema>[0];
};

export const instrumentOutputSchema = (
  outputSchema: StandardSchemaWithJSON,
  metricsSchema: z.ZodType
) =>
  z.intersection(
    z.fromJSONSchema(asJSONSchema(outputSchema, 'output')),
    z.object({
      instruments: z.object({ metrics: metricsSchema }),
    })
  );
