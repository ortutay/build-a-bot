import { isStandardSchemaWithJSON, standardSchemaToJSONSchema } from '@mastra/core/schema';
import { getOrNull } from '../util/index.js';

export const toolCacheInput = (input: unknown): unknown => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }
  const clean = { ...input } as Record<string, unknown>;
  delete clean._background;
  return clean;
};

export const toolCacheSchema = (schema: unknown, io: 'input' | 'output'): unknown => {
  const json = isStandardSchemaWithJSON(schema)
    ? standardSchemaToJSONSchema(schema, { io })
    : schema;
  if (io !== 'input' || !json || typeof json !== 'object') {
    return json;
  }
  const clean = structuredClone(json);
  // Mastra adds this optional execution control when an agent first uses a tool.
  // It is not a scraper capability and must not change the cache key.
  const properties = getOrNull<Record<string, unknown>>(clean, 'properties');
  if (properties) {
    delete properties._background;
  }
  return clean;
};
