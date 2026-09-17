import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { chromium, type Page } from 'playwright';
import { expect, it, vi } from 'vitest';
import { DocumentLibrary } from '../../src/documents/DocumentLibrary.js';
import { log } from '../../src/logger.js';
import { NetworkCapture } from '../../src/mastra/tools/browserTools/NetworkCapture.js';
import { likelyAdOrTracker } from '../../src/mastra/tools/browserTools/block.js';

it('captures delayed same-URL POSTs as separate immutable scoped documents', async () => {
  const server = createServer((req, resp) => {
    if (req.url === '/data') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        resp.setHeader('content-type', 'application/json');
        resp.end(JSON.stringify({ body }));
      });
    } else {
      resp.setHeader('content-type', 'text/html');
      resp.end('<button>Fetch</button>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const library = new DocumentLibrary();
    const capture = new NetworkCapture(page, library, 'cursor', 'none');
    const id = capture.begin();
    const address = server.address() as { port: number };
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fetch('/data', { method: 'POST', body: 'one' });
      await fetch('/data', { method: 'POST', body: 'two' });
    });
    const docs = await capture.wait('', 2, 2000, 'application/json');
    expect(new Set(docs.map((doc) => doc.id)).size).toBe(2);
    expect(library.list({ captureId: id })).toHaveLength(2);
    expect(docs.map((doc) => library.get({ documentId: doc.id })?.request.body).sort()).toEqual([
      'one',
      'two',
    ]);
    const other = await browser.newPage();
    const otherCapture = new NetworkCapture(other, library, 'other-cursor', 'none');
    const otherId = otherCapture.begin();
    await other.goto(`http://127.0.0.1:${address.port}`);
    await other.evaluate(() =>
      fetch('/data', { method: 'POST', body: 'other' }).then(() => undefined)
    );
    await otherCapture.wait('', 1, 2000);
    expect(library.list({ captureId: otherId })).toHaveLength(1);
    expect(capture.list()).toHaveLength(2);
    expect(otherId).not.toBe(id);
    capture.begin();
    expect(capture.list()).toEqual([]);
    expect(library.list({ captureId: id })).toHaveLength(2);
    await expect(capture.wait('', 1, 10)).rejects.toThrow('Timed out');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('skips redirect bodies, catches unavailable bodies, and isolates reused cursor IDs', async () => {
  const page = new EventEmitter();
  Object.assign(page, { isClosed: () => false });
  const library = new DocumentLibrary();
  const capture = new NetworkCapture(page as unknown as Page, library, 'reused', 'none');
  const first = capture.begin();
  const other = new NetworkCapture(
    new EventEmitter() as unknown as Page,
    library,
    'reused',
    'none'
  );
  expect(other.begin()).not.toBe(first);
  const request = { resourceType: () => 'fetch', url: () => 'https://example.test/jobs' };
  const body = vi.fn().mockRejectedValue(new Error('Response body unavailable'));
  const resp = {
    request: () => request,
    status: () => 302,
    allHeaders: async () => ({ 'content-type': 'application/json' }),
    body,
    url: request.url,
  };
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
  try {
    page.emit('request', request);
    page.emit('response', resp);
    await new Promise((resolve) => setImmediate(resolve));
    expect(body).not.toHaveBeenCalled();
    page.emit('response', { ...resp, status: () => 200 });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Response body unavailable'))
    );
    expect(capture.list()).toEqual([]);
  } finally {
    warn.mockRestore();
    capture.close();
    other.close();
  }
});

it('filters LinkedIn tracking requests from capture', () => {
  const request = {
    frame: () => ({ url: () => 'https://jobs.smartrecruiters.com/' }),
    resourceType: () => 'fetch',
    url: () => 'https://www.linkedin.com/li/track?x=1',
  };

  expect(likelyAdOrTracker(request as any)).toBe(true);
});

it('discards a response body that fails after its page closes', async () => {
  let closed = false;
  const page = new EventEmitter();
  Object.assign(page, { isClosed: () => closed });
  const library = new DocumentLibrary();
  const capture = new NetworkCapture(page as unknown as Page, library, 'cursor', 'none');
  capture.begin();
  const request = { resourceType: () => 'fetch', url: () => 'https://example.test/jobs' };
  let rejectBody: (e: Error) => void;
  const body = vi.fn(
    () =>
      new Promise<Buffer>((_resolve, reject) => {
        rejectBody = reject;
      })
  );
  const resp = {
    request: () => request,
    status: () => 200,
    allHeaders: async () => ({ 'content-type': 'application/json' }),
    body,
    url: request.url,
  };
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
  try {
    page.emit('request', request);
    page.emit('response', resp);
    await vi.waitFor(() => expect(body).toHaveBeenCalledOnce());
    closed = true;
    page.emit('close');
    rejectBody!(new Error('Target page, context or browser has been closed'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).not.toHaveBeenCalled();
    expect(capture.list()).toEqual([]);
  } finally {
    warn.mockRestore();
    capture.close();
  }
});
