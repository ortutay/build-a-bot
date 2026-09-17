import { createServer } from 'node:http';
import { chromium, type Page } from 'playwright';
import { expect, it } from 'vitest';
import { DocumentLibrary } from '../../src/documents/DocumentLibrary.js';
import { NetworkCapture } from '../../src/mastra/tools/browserTools/NetworkCapture.js';
import { executors } from '../../src/mastra/tools/browserTools/tools.js';

type Fixture = {
  page: Page;
  url: string;
  library: DocumentLibrary;
  capture: NetworkCapture;
  session: { getCursor: () => Promise<{ page: Page; proxy: string }> };
};
const fixture = async (check: (env: Fixture) => Promise<void>) => {
  const server = createServer((req, resp) => {
    resp.setHeader('content-type', req.url === '/' ? 'text/html' : 'application/json');
    resp.end(req.url === '/' ? '<p>Ready</p>' : JSON.stringify({ path: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const library = new DocumentLibrary();
    const capture = NetworkCapture.for(page, library, 'test', 'none');
    capture.begin();
    await page.goto(url);
    const session = { getCursor: async () => ({ page, proxy: 'none' }) };
    await check({ page, url, library, capture, session });
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};

it('waits for every required endpoint despite unrelated completed JSON', async () => {
  await fixture(async ({ page, url, library, capture, session }) => {
    let resolved = false;
    const ready = executors
      .networkTool(library, session, {
        cursorId: 'test',
        minCount: 2,
        contentType: 'application/json',
        timeout: 2000,
        requiredUrlPrefixes: [`${url}/product`, `${url}/price`],
      })
      .then((val: { documents: Array<{ url: string }> }) => {
        resolved = true;
        return val;
      });
    await page.evaluate(() => Promise.all([fetch('/config'), fetch('/features')]));
    await capture.wait('', 2, 2000, 'application/json');
    expect(resolved).toBe(false);
    await page.evaluate(() => fetch('/product'));
    await capture.wait(`${url}/product`, 1, 2000, 'application/json');
    expect(resolved).toBe(false);
    await page.evaluate(() => fetch('/price'));
    const result = await ready;
    expect(result.documents.map((doc: { url: string }) => doc.url)).toEqual(
      expect.arrayContaining([`${url}/product`, `${url}/price`])
    );
  });
});

it('rejects a missing required endpoint instead of accepting unrelated JSON', async () => {
  await fixture(async ({ page, url, library, session }) => {
    await page.evaluate(() => fetch('/config'));
    await expect(
      executors.networkTool(library, session, {
        cursorId: 'test',
        minCount: 0,
        timeout: 50,
        requiredUrlPrefixes: [`${url}/missing`],
      })
    ).rejects.toThrow('Timed out');
  });
});
