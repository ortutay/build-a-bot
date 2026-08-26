import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documentLibrary } from '../../src/internal/documents/index.js';
import { BrowserToolCache } from '../../src/internal/mastra/tools/browserTools/BrowserToolCache.js';
import {
  closeBrowserTools,
  createBrowserTools,
  executors,
} from '../../src/internal/mastra/tools/browserTools/tools.js';
import { createDocumentTools } from '../../src/internal/mastra/tools/documents/tools.js';
import { MemoryCache } from '../lib/MemoryCache.js';
import { startMockDynamicJsonSite } from '../lib/mockDynamicJsonSite.js';
import { startMockEcommerceSite } from '../lib/mockEcommerceSite.js';

const documentContent = (documentId: string): string => {
  const document = documentLibrary.get({ documentId });
  if (!document) throw new Error(`Missing saved document: ${documentId}`);
  return document.content;
};

describe('browser tools', () => {
  let site: Awaited<ReturnType<typeof startMockEcommerceSite>>;

  beforeAll(async () => {
    site = await startMockEcommerceSite();
  });

  afterAll(async () => {
    await closeBrowserTools();
    if (site) await site.close();
  });

  describe('BrowserToolCache', () => {
    it('checks the first tool call using an empty sequence', async () => {
      const backend = new MemoryCache();
      const cache = new BrowserToolCache(backend);
      const input = { cursorId: 'warm-page', url: `${site.baseUrl}/` };
      const output = { status: 200, ok: true };

      await cache.recordToolCall('warm-page', 'browserTools_gotoTool', input, output);

      await expect(
        cache.checkToolCall('fresh-page', 'browserTools_gotoTool', {
          ...input,
          cursorId: 'fresh-page',
        })
      ).resolves.toEqual({ cached: output, hit: true, steps: [] });
    });

    it('returns the completed prefix as replay steps on a miss', async () => {
      const cache = new BrowserToolCache(new MemoryCache());
      await cache.recordToolCall(
        'page',
        'browserTools_gotoTool',
        { cursorId: 'page', url: `${site.baseUrl}/` },
        { status: 200, ok: true }
      );

      const result = await cache.checkToolCall('page', 'browserTools_clickTool', {
        cursorId: 'page',
        selector: '#add-to-cart',
      });

      expect(result.hit).toBe(false);
      expect(result.steps).toEqual([
        {
          toolId: 'browserTools_gotoTool',
          input: { url: `${site.baseUrl}/` },
        },
      ]);
    });

    it('builds the same key for different page IDs', async () => {
      const backend = new MemoryCache();
      const first = new BrowserToolCache(backend);
      const second = new BrowserToolCache(backend);
      const output = '<html>cached</html>';

      await first.recordToolCall(
        'first-page',
        'browserTools_contentTool',
        { cursorId: 'first-page' },
        output
      );

      await expect(
        second.checkToolCall('second-page', 'browserTools_contentTool', {
          cursorId: 'second-page',
        })
      ).resolves.toEqual({ cached: output, hit: true, steps: [] });
    });
  });

  describe('executors in isolation', () => {
    afterEach(async () => {
      await closeBrowserTools();
      site.resetRequests();
    });

    it('allocates distinct page IDs', async () => {
      const first = await executors.newPageTool({});
      const second = await executors.newPageTool({});

      expect(first.cursorId).toBeTruthy();
      expect(second.cursorId).toBeTruthy();
      expect(second.cursorId).not.toBe(first.cursorId);
    });

    it('navigates and returns a saved document ID', async () => {
      const { cursorId } = await executors.newPageTool({});

      await expect(
        executors.gotoTool({ cursorId, url: `${site.baseUrl}/products/footwear-1` })
      ).resolves.toEqual({ status: 200, ok: true });
      const result = await executors.contentTool({ cursorId });
      expect(result).toEqual({
        documentId: expect.stringMatching(/^doc:/),
        summary: {
          id: result.documentId,
          url: `${site.baseUrl}/products/footwear-1`,
          origin: 'navigation',
          contentType: 'text/html',
          status: 200,
          bytes: expect.any(Number),
        },
      });
      expect(documentLibrary.get({ documentId: result.documentId })).toMatchObject({
        origin: 'navigation',
        contentType: 'text/html',
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        request: {
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          proxy: null,
          mode: 'browser',
        },
      });
      expect(documentContent(result.documentId)).toContain('Red Sneakers');
    });

    it('shows ten products per category page', async () => {
      const { cursorId } = await executors.newPageTool({});
      await executors.gotoTool({ cursorId, url: `${site.baseUrl}/categories/footwear?page=1` });
      const firstPage = await executors.contentTool({ cursorId });

      expect(documentContent(firstPage.documentId).match(/class="product-card"/g)).toHaveLength(10);
      expect(documentContent(firstPage.documentId)).toContain('Page 1 of 2');

      await executors.gotoTool({ cursorId, url: `${site.baseUrl}/categories/footwear?page=2` });
      const secondPage = await executors.contentTool({ cursorId });
      expect(documentContent(secondPage.documentId).match(/class="product-card"/g)).toHaveLength(2);
      expect(documentContent(secondPage.documentId)).toContain('Page 2 of 2');
    });

    it('searches product names using a case-insensitive substring', async () => {
      const { cursorId } = await executors.newPageTool({});
      await executors.gotoTool({ cursorId, url: `${site.baseUrl}/search?q=SNEAKERS` });
      const content = await executors.contentTool({ cursorId });

      expect(documentContent(content.documentId)).toContain('Red Sneakers');
      expect(documentContent(content.documentId)).toContain('Canvas Sneakers');
      expect(documentContent(content.documentId)).toContain('High-Top Sneakers');
      expect(documentContent(content.documentId)).not.toContain('Trail Boots');
    });

    it('waits for selectors and clicks elements', async () => {
      const { cursorId } = await executors.newPageTool({});
      await executors.gotoTool({ cursorId, url: `${site.baseUrl}/` });

      await expect(
        executors.waitForSelectorTool({
          cursorId,
          selector: '#delayed-offer',
          timeout: 1_000,
        })
      ).resolves.toEqual({ found: true });
      await expect(
        executors.clickTool({ cursorId, selector: '#add-to-cart', timeout: 1_000 })
      ).resolves.toEqual({ ok: true });

      const content = await executors.contentTool({ cursorId });
      expect(documentContent(content.documentId)).toContain('data-cart-updated="true"');
      expect(documentContent(content.documentId)).toContain('<span id="cart-count">1</span>');
    });

    it('clicks a selected match by zero-based index', async () => {
      const { cursorId } = await executors.newPageTool({});
      await executors.gotoTool({ cursorId, url: `${site.baseUrl}/` });

      await expect(
        executors.clickTool({
          cursorId,
          selector: 'a.category-link',
          index: 1,
          timeout: 1_000,
        })
      ).resolves.toEqual({ ok: true });

      const content = await executors.contentTool({ cursorId });
      expect(documentContent(content.documentId)).toContain('Electronics');
    });
  });

  describe('dynamic request capture', () => {
    let dynamicSite: Awaited<ReturnType<typeof startMockDynamicJsonSite>>;

    beforeAll(async () => {
      dynamicSite = await startMockDynamicJsonSite();
    });

    afterAll(async () => {
      await closeBrowserTools();
      await dynamicSite.close();
    });

    afterEach(async () => {
      await closeBrowserTools();
    });

    it('captures initial JSON requests as dynamic documents', async () => {
      const { cursorId } = await executors.newPageTool({});

      await executors.gotoTool({ cursorId, url: `${dynamicSite.baseUrl}/` });
      await executors.waitForSelectorTool({
        cursorId,
        selector: '[data-product-id="json-widget"]',
      });
      const content = await executors.contentTool({ cursorId });

      expect(content.documentId).toMatch(/^doc:/);

      const [dynamic] = documentLibrary.list({
        origin: 'dynamic',
        urlPrefix: `${dynamicSite.baseUrl}/api/catalog`,
      });
      const dynamicDocument = documentLibrary.get({ documentId: dynamic.id });
      expect(dynamicDocument).toMatchObject({
        url: `${dynamicSite.baseUrl}/api/catalog`,
        origin: 'dynamic',
        contentType: 'application/json',
        status: 200,
        request: {
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          proxy: null,
          mode: 'browser',
        },
        content: expect.stringContaining('JSON Widget'),
      });
    });
  });

  describe('agent document flow', () => {
    afterEach(async () => {
      await closeBrowserTools();
      site.resetRequests();
    });

    it('uses browser tools to save a page and document tools to inspect it', async () => {
      const browserTools = await createBrowserTools(new BrowserToolCache(new MemoryCache()));
      const documentTools = await createDocumentTools();

      const agent = {
        inspectProduct: async () => {
          const newPage = browserTools.browserTools_newPageTool.execute;
          const goto = browserTools.browserTools_gotoTool.execute;
          const content = browserTools.browserTools_contentTool.execute;
          const getDocument = documentTools.documentTools_getTool.execute;
          if (!newPage || !goto || !content || !getDocument) {
            throw new Error('Expected browser and document tools to be executable');
          }

          const { cursorId } = (await newPage({}, {} as any)) as any;
          await goto({ cursorId, url: `${site.baseUrl}/products/footwear-1` }, {} as any);
          const { documentId } = (await content({ cursorId }, {} as any)) as any;
          return getDocument({ documentId, format: 'slimHtml', transform: 'none' }, {} as any);
        },
      };

      await expect(agent.inspectProduct()).resolves.toMatchObject({
        format: 'slimHtml',
        content: expect.stringContaining('Red Sneakers'),
      });
    });
  });

  describe('browser caching integration', () => {
    let tools: Awaited<ReturnType<typeof createBrowserTools>>;

    const execute = async (name: string, input: Record<string, any> = {}): Promise<any> => {
      const tool = tools[`browserTools_${name}Tool`];
      if (!tool?.execute) {
        throw new Error(`Missing executable browser tool: ${name}`);
      }
      const result = await tool.execute(input, {} as any);
      if (typeof result !== 'object' || result === null || !('instruments' in result)) {
        throw new Error(`Browser tool did not return runtime metrics: ${name}`);
      }
      return result;
    };

    beforeEach(async () => {
      const cache = new BrowserToolCache(new MemoryCache());
      tools = await createBrowserTools(cache);
      site.resetRequests();
    });

    afterEach(async () => {
      await closeBrowserTools();
    });

    it('orders concurrent operations submitted for one page', async () => {
      const page = await execute('newPage');

      const results = await Promise.allSettled([
        execute('goto', {
          cursorId: page.cursorId,
          url: `${site.baseUrl}/products/footwear-1`,
        }),
        execute('content', { cursorId: page.cursorId }),
      ]);

      expect(results).toEqual([
        {
          status: 'fulfilled',
          value: expect.objectContaining({ ok: true, status: 200 }),
        },
        {
          status: 'fulfilled',
          value: expect.objectContaining({ documentId: expect.stringMatching(/^doc:/) }),
        },
      ]);
    });

    it('runs operations for different page IDs independently', async () => {
      const warmPage = await execute('newPage');
      await execute('content', { cursorId: warmPage.cursorId });

      const slowPage = await execute('newPage');
      const fastPage = await execute('newPage');
      const timeout = 250;
      const startedAt = performance.now();
      const slow = execute('waitForSelector', {
        cursorId: slowPage.cursorId,
        selector: '#does-not-exist',
        timeout,
      });
      const fast = execute('content', { cursorId: fastPage.cursorId });

      await expect(fast).resolves.toEqual(
        expect.objectContaining({ documentId: expect.any(String) })
      );
      expect(performance.now() - startedAt).toBeLessThan(timeout / 2);
      await expect(slow).rejects.toThrow();
    });

    it('serves a complete cached sequence without revisiting the site', async () => {
      const firstPage = await execute('newPage');
      const firstGoto = await execute('goto', {
        cursorId: firstPage.cursorId,
        url: `${site.baseUrl}/products/footwear-1`,
      });
      const firstContent = await execute('content', { cursorId: firstPage.cursorId });
      expect(site.requestCount('/products/footwear-1')).toBe(1);

      const secondPage = await execute('newPage');
      const secondGoto = await execute('goto', {
        cursorId: secondPage.cursorId,
        url: `${site.baseUrl}/products/footwear-1`,
      });
      const secondContent = await execute('content', { cursorId: secondPage.cursorId });

      expect(secondGoto).toMatchObject({ ok: firstGoto.ok, status: firstGoto.status });
      expect(documentContent(secondContent.documentId)).toBe(
        documentContent(firstContent.documentId)
      );
      expect(firstContent.instruments.metrics.runtime).toEqual(expect.any(Number));
      expect(site.requestCount('/products/footwear-1')).toBe(1);
    });

    it('replays the cached prefix once when switching to live execution', async () => {
      const warmPage = await execute('newPage');
      await execute('goto', {
        cursorId: warmPage.cursorId,
        url: `${site.baseUrl}/`,
      });
      expect(site.requestCount('/')).toBe(1);

      const replayedPage = await execute('newPage');
      await execute('goto', {
        cursorId: replayedPage.cursorId,
        url: `${site.baseUrl}/`,
      });
      expect(site.requestCount('/')).toBe(1);

      await execute('click', {
        cursorId: replayedPage.cursorId,
        selector: '#add-to-cart',
        timeout: 1_000,
      });
      expect(site.requestCount('/')).toBe(2);

      const firstContent = await execute('content', { cursorId: replayedPage.cursorId });
      const secondContent = await execute('content', { cursorId: replayedPage.cursorId });

      expect(documentContent(firstContent.documentId)).toContain('data-cart-updated="true"');
      expect(documentContent(secondContent.documentId)).toContain('data-cart-updated="true"');
      expect(site.requestCount('/')).toBe(2);
    });

    it('replays cached navigation and clicks before an uncached call', async () => {
      const warmPage = await execute('newPage');
      await execute('goto', { cursorId: warmPage.cursorId, url: `${site.baseUrl}/` });
      await execute('click', {
        cursorId: warmPage.cursorId,
        selector: '#add-to-cart',
        timeout: 1_000,
      });
      expect(site.requestCount('/')).toBe(1);

      const cachedPage = await execute('newPage');
      await execute('goto', { cursorId: cachedPage.cursorId, url: `${site.baseUrl}/` });
      await execute('click', {
        cursorId: cachedPage.cursorId,
        selector: '#add-to-cart',
        timeout: 1_000,
      });
      expect(site.requestCount('/')).toBe(1);

      const content = await execute('content', { cursorId: cachedPage.cursorId });

      expect(documentContent(content.documentId)).toContain('data-cart-updated="true"');
      expect(documentContent(content.documentId)).toContain('<span id="cart-count">1</span>');
      expect(site.requestCount('/')).toBe(2);
    });
  });
});
