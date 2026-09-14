import { isStandardSchemaWithJSON, standardSchemaToJSONSchema } from '@mastra/core/schema';
import { getOrNull } from '../util/index.js';

export const toolCacheSchema = (schema: unknown, io: 'input' | 'output'): unknown => {
  const json = isStandardSchemaWithJSON(schema)
    ? standardSchemaToJSONSchema(schema, { io })
    : schema;
  if (io !== 'input' || !json || typeof json !== 'object') {
    return json;
  }
  const clean = structuredClone(json);
  // Mastra adds this optional execution control when an agent first uses a tool.
  // It is not a scraper capability and must not invalidate persisted scripts.
  const properties = getOrNull<Record<string, unknown>>(clean, 'properties');
  if (properties) {
    delete properties._background;
  }
  return clean;
};
