import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DiskCache } from '../../src/cache/DiskCache.js';
import { toolCacheInput, toolCacheSchema } from '../../src/cache/toolCacheKey.js';
import { cacheInstrument } from '../../src/mastra/instruments/cacheInstrument.js';

it.each([{ ok: false }, { error: true }, { isError: true }])(
  'does not cache returned failures: %j',
  async (failure) => {
    const execute = vi.fn().mockResolvedValueOnce(failure).mockResolvedValue({ ok: true });
    const tool = await cacheInstrument({ id: randomUUID(), execute } as any);
    await tool.execute!({}, {} as any);
    await tool.execute!({}, {} as any);
    await tool.execute!({}, {} as any);
    expect(execute).toHaveBeenCalledTimes(2);
  }
);

it.each([{ ok: false }, { error: true }, { isError: true }])(
  'ignores already cached failures: %j',
  async (failure) => {
    const get = vi
      .spyOn(DiskCache.prototype, 'get')
      .mockResolvedValueOnce({ type: 'output', output: failure });
    try {
      const execute = vi.fn(async () => ({ ok: true }));
      const tool = await cacheInstrument({ id: randomUUID(), execute } as any);
      await tool.execute!({}, {} as any);
      await tool.execute!({}, {} as any);
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      get.mockRestore();
    }
  }
);

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

it('ignores background execution settings in cache keys without changing tool arguments', async () => {
  const execute = vi.fn(async () => ({ ok: true }));
  const tool = await cacheInstrument({ id: randomUUID(), execute } as any);
  const input = { url: 'https://example.test', _background: { enabled: true } };
  await tool.execute!(input, {} as any);
  await tool.execute!({ url: input.url }, {} as any);
  await tool.execute!({ ...input, _background: { enabled: false } }, {} as any);
  expect(execute).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledWith(input, {});
  expect(input._background).toEqual({ enabled: true });
  await tool.execute!({ url: 'https://other.test' }, {} as any);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(toolCacheInput({ data: { _background: 'content' }, _background: true })).toEqual({
    data: { _background: 'content' },
  });
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
