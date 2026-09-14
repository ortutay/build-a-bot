import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toolCacheSchema } from '../../src/cache/toolCacheKey.js';
import { cacheInstrument } from '../../src/mastra/instruments/cacheInstrument.js';

it('reuses a tool result when Mastra adds _background, but invalidates real schema changes', async () => {
  const execute = vi.fn(async () => ({ ok: true }));
  const base = z.object({ url: z.string() });
  const tool = {
    id: 'tool-schema-' + randomUUID(),
    execute,
    inputSchema: base,
    outputSchema: z.object({ ok: z.boolean() }),
  };
  const input = { url: 'https://example.test' };
  const call = async () => (await cacheInstrument(tool as any)).execute!(input, {} as any);
  await call();
  tool.inputSchema = base.extend({ _background: z.boolean().optional() });
  const repeated = await call();
  expect(repeated).toMatchObject({ instruments: { metrics: { cache: { result: 'hit' } } } });
  expect(execute).toHaveBeenCalledOnce();
  tool.inputSchema = base.extend({ format: z.string().optional() });
  await call();
  expect(execute).toHaveBeenCalledTimes(2);
  tool.inputSchema = base;
  tool.outputSchema = z.object({ ok: z.boolean(), detail: z.string().optional() });
  await call();
  expect(execute).toHaveBeenCalledTimes(3);
});

it('does not mutate schemas or discard nested/output fields named _background', () => {
  const schema = {
    type: 'object',
    properties: {
      _background: { type: 'boolean' },
      data: { type: 'object', properties: { _background: { type: 'string' } } },
    },
  };
  const before = structuredClone(schema);
  expect(toolCacheSchema(schema, 'input')).toEqual({
    type: 'object',
    properties: { data: schema.properties.data },
  });
  expect(schema).toEqual(before);
  expect(toolCacheSchema(schema, 'output')).toEqual(before);
});
