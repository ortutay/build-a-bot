import type { FromSchema } from 'json-schema-to-ts';
import { Tool } from './Tool.js';
import * as shared from './parameters.js';

const inputSchema = {
  type: 'object',
  properties: {
    url: shared.url,
  },
  required: ['url'],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    ok: { type: 'boolean' },
    status: { type: 'number' },
    statusText: { type: 'string' },
    headers: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    body: { type: 'string' },
  },
  required: ['url', 'ok', 'status', 'statusText', 'headers', 'body'],
  additionalProperties: false,
} as const;

type Input = FromSchema<typeof inputSchema>;
type Output = FromSchema<typeof outputSchema>;

const fn = async (input: Input): Promise<Output> => {
  const resp = await fetch(input.url);
  return {
    url: resp.url,
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    headers: Object.fromEntries(resp.headers),
    body: await resp.text(),
  };
};

export const fetchTool = new Tool(
  'fetchTool',
  `Fetch a URL using node's built-in fetch() function`,
  inputSchema,
  outputSchema,
  fn
);
