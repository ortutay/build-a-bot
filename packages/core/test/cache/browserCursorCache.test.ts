import { expect, it, vi } from 'vitest';
import { documentLibrary } from '../../src/documents/index.js';
import { BrowserSession } from '../../src/mastra/tools/browserTools/BrowserSession.js';
import { BrowserToolCache } from '../../src/mastra/tools/browserTools/BrowserToolCache.js';
import { browserCacheInstrument } from '../../src/mastra/tools/browserTools/instruments.js';
import { closeBrowserTools, executors } from '../../src/mastra/tools/browserTools/tools.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { MemoryCache } from '../lib/MemoryCache.js';

it.each([{ ok: false }, { error: true }, { isError: true }])(
  'excludes browser failures and their subsequent results: %j',
  async (failure) => {
    const backend = new MemoryCache();
    const cache = new BrowserToolCache(backend);
    await cache.recordToolCall('failed', 'goto', { url: 'https://example.test' }, failure);
    await cache.recordToolCall('failed', 'content', {}, { text: 'error page' });
    expect(backend.entries.size).toBe(0);
    expect((await cache.checkToolCall('fresh', 'goto', { url: 'https://example.test' })).hit).toBe(
      false
    );
    await cache.recordToolCall('fresh', 'goto', { url: 'https://example.test' }, { ok: true });
    expect(
      (await cache.checkToolCall('another', 'goto', { url: 'https://example.test' })).hit
    ).toBe(true);
  }
);

it.each([null, false, 0, ''])(
  'treats stored %j as a cache hit and undefined as a miss',
  async (output) => {
    const cache = new BrowserToolCache(new MemoryCache());
    expect((await cache.checkToolCall('fresh', 'content', {})).hit).toBe(false);
    await cache.recordToolCall('first', 'content', {}, output);
    expect(await cache.checkToolCall('second', 'content', {})).toEqual({
      cached: output,
      hit: true,
      steps: [],
    });
  }
);

it('ignores background settings in browser cache keys and replay prefixes', async () => {
  const cache = new BrowserToolCache(new MemoryCache());
  const input = { cursorId: 'old', url: 'https://example.test', _background: { enabled: true } };
  await cache.recordToolCall('old', 'goto', input, { ok: true });
  expect(await cache.checkToolCall('new', 'goto', { url: input.url })).toMatchObject({ hit: true });
  expect(await cache.checkToolCall('new', 'goto', { url: 'https://other.test' })).toMatchObject({
    hit: false,
  });
  expect((await cache.checkToolCall('old', 'content', {})).steps).toEqual([
    { toolId: 'goto', input: { url: input.url } },
  ]);
  expect(input._background).toEqual({ enabled: true });
});

it('resets reused cursor history and live status while keeping other cursors and cached results', async () => {
  const cache = new BrowserToolCache(new MemoryCache());
  const session = new BrowserSession(new ProxyRegistry([new NoProxy()]));
  const replay = vi.fn(async () => {});
  const instrument = browserCacheInstrument(replay, cache, session);
  const newPage = await instrument({
    id: 'browserTools_newPageTool',
    execute: (input: unknown, context: unknown) =>
      executors.newPageTool(documentLibrary, session, input, context),
  } as any);
  const goto = vi.fn(async () => ({ ok: true }));
  const navigation = await instrument({ id: 'browserTools_gotoTool', execute: goto } as any);
  const context = { toolCallId: 'repeated-call' } as any;
  try {
    const first = (await newPage.execute!({}, context)) as { cursorId: string };
    const input = { cursorId: first.cursorId, url: 'https://example.test' };
    await navigation.execute!(input, {} as any); // Cache miss marks the cursor live.
    await cache.recordToolCall('other', 'goto', { url: 'https://other.test' }, { ok: true });
    const other = structuredClone(cache.sequences.other);

    const second = (await newPage.execute!({}, context)) as { cursorId: string };
    expect(second.cursorId).toBe(first.cursorId);
    expect(cache.sequences[first.cursorId]).toBeUndefined();
    expect(cache.sequences.other).toEqual(other);
    await navigation.execute!({ ...input, _background: false }, {} as any);
    expect(goto).toHaveBeenCalledOnce(); // The reset cursor checks the cache again.
    expect(replay).not.toHaveBeenCalled();

    await navigation.execute!({ ...input, url: 'https://example.test/next' }, {} as any);
    expect(replay).toHaveBeenCalledExactlyOnceWith(first.cursorId, [
      { toolId: 'browserTools_gotoTool', input: { url: input.url, proxy: 'none' } },
    ]);
  } finally {
    await closeBrowserTools();
  }
});
