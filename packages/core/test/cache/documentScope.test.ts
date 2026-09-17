import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { DocumentLibrary, DiskLibraryBackend } from '../../src/documents/index.js';
import { BrowserToolCache } from '../../src/mastra/tools/browserTools/BrowserToolCache.js';
import { createTools } from '../../src/mastra/tools/fetchTools/tools.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { MemoryCache } from '../lib/MemoryCache.js';

it('isolates fetch references between stores while retaining persistent-store cache hits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-scope-'));
  try {
    const proxy = new NoProxy();
    const fetch = vi
      .spyOn(proxy, 'fetch')
      .mockImplementation(
        async () => new Response('<p>Data</p>', { headers: { 'content-type': 'text/html' } })
      );
    const a = new DocumentLibrary(new DiskLibraryBackend('a', { rootDir: root }));
    const b = new DocumentLibrary(new DiskLibraryBackend('b', { rootDir: root }));
    const again = new DocumentLibrary(new DiskLibraryBackend('a', { rootDir: root }));
    for (const library of [a, b, again]) {
      const tools = await createTools({
        documentLibrary: library,
        proxyRegistry: new ProxyRegistry([proxy]),
      });
      const out = (await tools.fetchTool.execute!(
        { url: 'https://example.test/scope', proxy: 'none' },
        {} as never
      )) as { documentId: string };
      expect(library.get({ documentId: out.documentId })?.content).toBe('<p>Data</p>');
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new DocumentLibrary().cacheScope).not.toBe(new DocumentLibrary().cacheScope);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('isolates browser sequence entries between document stores', async () => {
  const backend = new MemoryCache();
  const a = new BrowserToolCache(backend, 'a');
  const b = new BrowserToolCache(backend, 'b');
  await a.recordToolCall('first', 'content', {}, { documentId: 'a-only' });
  expect((await a.checkToolCall('again', 'content', {})).hit).toBe(true);
  expect((await b.checkToolCall('first', 'content', {})).hit).toBe(false);
});
