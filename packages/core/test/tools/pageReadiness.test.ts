import type { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/documents/index.js';
import { BrowserSession } from '../../src/mastra/tools/browserTools/BrowserSession.js';
import { withReadiness } from '../../src/mastra/tools/browserTools/readiness.js';
import { executors } from '../../src/mastra/tools/browserTools/tools.js';
import { createTools } from '../../src/mastra/tools/fetchTools/tools.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';

const listenerCount = (page: Page, event: string) =>
  (page as unknown as EventEmitter).listenerCount(event);

const registry = new ProxyRegistry([new NoProxy()]);
const library = new DocumentLibrary(new MemoryLibraryBackend());
const session = new BrowserSession(registry);
const server = createServer((req, resp) => {
  if (req.url === '/hydrate') {
    resp.setHeader('content-type', 'text/html');
    resp.end(
      '<main id=job>Loading</main><script>fetch("/data").then(r=>r.json()).then(d=>document.querySelector("main").textContent=d.title)</script>'
    );
    return;
  }
  if (req.url === '/data') {
    setTimeout(() => {
      resp.setHeader('content-type', 'application/json');
      resp.end(JSON.stringify({ title: 'Engineer' }));
    }, 200);
    return;
  }
  if (req.url === '/pending.png') {
    return;
  }
  if (req.url === '/jobs.md') {
    resp.setHeader('content-type', 'text/markdown; charset=utf-8');
    resp.end('# Engineer\n\nLocation: Sweden');
    return;
  }
  resp.setHeader('content-type', 'text/html');
  resp.end(
    '<html><body><h1>Engineer</h1><form><label>Email<input name="email" type="email" required></label></form><img src="/pending.png"></body></html>'
  );
});
let url: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await session.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it('returns useful DOM while an unrelated asset keeps load pending', async () => {
  const { cursorId } = await session.createCursor('readiness', 'none');
  const cursor = await session.getCursor(cursorId);
  await expect(cursor.page.goto(url, { waitUntil: 'load', timeout: 250 })).rejects.toThrow(
    'Timeout'
  );
  await expect(executors.gotoTool(library, session, { cursorId, url })).resolves.toMatchObject({
    ok: true,
  });
  expect(await cursor.page.locator('input[name=email]').count()).toBe(1);
});
it('preserves Markdown content without HTML conversion', async () => {
  const tools = await createTools({ documentLibrary: library, proxyRegistry: registry });
  const result: any = await tools.fetchTool.execute!(
    { url: `${url}/jobs.md`, proxy: 'none' },
    {} as any
  );
  expect(result.ok).toBe(true);
  const doc = library.get({ documentId: result.documentId, format: 'raw', transform: 'none' });
  expect(doc?.content).toBe('# Engineer\n\nLocation: Sweden');
  expect(doc?.contentType).toBe('text/markdown');
});

it('waits for asynchronous job content and removes its listeners', async () => {
  const { cursorId } = await session.createCursor('hydration', 'none');
  const { page } = await session.getCursor(cursorId);
  const before = listenerCount(page, 'request');
  const out = await withReadiness(page, () => page.goto(`${url}/hydrate`, { waitUntil: 'commit' }));
  expect(out.readiness.state).toBe('settled');
  expect(await page.locator('main').innerText()).toBe('Engineer');
  expect(listenerCount(page, 'request')).toBe(before);
  expect(listenerCount(page, 'requestfinished')).toBe(0);
});
it('reports unresolved dynamic requests as a timeout and cleans up on failure', async () => {
  const { cursorId } = await session.createCursor('pending', 'none');
  const { page } = await session.getCursor(cursorId);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const out = await withReadiness(
    page,
    () =>
      page.evaluate(() => {
        void fetch('/pending.png');
      }),
    { timeout: 150 }
  );
  expect(out.readiness.state).toBe('timeout');
  expect(out.readiness.pending).toBe(1);
  await expect(
    withReadiness(page, async () => {
      throw new Error('action failed');
    })
  ).rejects.toThrow('action failed');
  expect(listenerCount(page, 'request')).toBe(0);
});

it.each([null, ''])('treats empty GET body %s as omitted', async (body) => {
  const tools = await createTools({ documentLibrary: library, proxyRegistry: registry });
  const result: any = await tools.fetchTool.execute!(
    { url: `${url}/jobs.md`, proxy: 'none', method: 'GET', body },
    {} as any
  );
  expect(result.ok).toBe(true);
});
it('still rejects nonempty GET bodies', async () => {
  const tools = await createTools({ documentLibrary: library, proxyRegistry: registry });
  const result: any = await tools.fetchTool.execute!(
    { url: `${url}/jobs.md`, proxy: 'none', method: 'GET', body: 'nonempty' },
    {} as any
  );
  expect(result.error).toBe(true);
});
