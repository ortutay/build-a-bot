import { expect, it } from 'vitest';
import { BrowserToolCache } from '../../src/mastra/tools/browserTools/BrowserToolCache.js';
import { MemoryCache } from '../lib/MemoryCache.js';

it('does not reuse or overwrite settled content after an unsettled navigation', async () => {
  const cache = new BrowserToolCache(new MemoryCache());
  const nav = { url: 'https://example.test/job', proxy: 'none' };
  const settled = { ok: true, readiness: { state: 'settled' } };
  await cache.recordToolCall('warm', 'browserTools_gotoTool', nav, settled);
  await cache.recordToolCall('warm', 'browserTools_contentTool', {}, { documentId: 'complete' });
  await cache.recordToolCall('slow', 'browserTools_gotoTool', nav, {
    ok: true,
    readiness: { state: 'timeout' },
  });
  expect((await cache.checkToolCall('slow', 'browserTools_contentTool', {})).hit).toBe(false);
  await cache.recordToolCall('slow', 'browserTools_contentTool', {}, { documentId: 'incomplete' });
  await cache.recordToolCall('later', 'browserTools_gotoTool', nav, settled, false);
  expect((await cache.checkToolCall('later', 'browserTools_contentTool', {})).cached).toEqual({
    documentId: 'complete',
  });
});
