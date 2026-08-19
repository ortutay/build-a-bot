import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BrowserToolCache } from '../../src/tools/browserTools/BrowserToolCache.js';
import {
  closeBrowserTools,
  createBrowserTools,
  executors,
} from '../../src/tools/browserTools/tools.js';
import { MemoryCache } from '../lib/MemoryCache.js';
import { startMockEcommerceSite } from '../lib/mockEcommerceSite.js';

describe('browser tools', () => {
  let site: Awaited<ReturnType<typeof startMockEcommerceSite>>;

  beforeAll(async () => {
    site = await startMockEcommerceSite();
  });

  afterAll(async () => {
    await closeBrowserTools();
    await site.close();
  });

  describe('BrowserToolCache', () => {
    it('checks the first tool call using an empty sequence', async () => {
      const backend = new MemoryCache();
      const cache = new BrowserToolCache(backend);
      const input = { pageId: 'warm-page', url: `${site.baseUrl}/` };
      const output = { status: 200, ok: true };

      await cache.recordToolCall('warm-page', 'browserTools_gotoTool', input, output);

      await expect(
        cache.checkToolCall('fresh-page', 'browserTools_gotoTool', {
          ...input,
          pageId: 'fresh-page',
        })
      ).resolves.toEqual({ cached: output, hit: true, steps: [] });
    });

    it('returns the completed prefix as replay steps on a miss', async () => {
      const cache = new BrowserToolCache(new MemoryCache());
      await cache.recordToolCall(
        'page',
        'browserTools_gotoTool',
        { pageId: 'page', url: `${site.baseUrl}/` },
        { status: 200, ok: true }
      );

      const result = await cache.checkToolCall('page', 'browserTools_clickTool', {
        pageId: 'page',
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
        { pageId: 'first-page' },
        output
      );

      await expect(
        second.checkToolCall('second-page', 'browserTools_contentTool', {
          pageId: 'second-page',
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

      expect(first.pageId).toBeTruthy();
      expect(second.pageId).toBeTruthy();
      expect(second.pageId).not.toBe(first.pageId);
    });

    it('navigates and returns page content', async () => {
      const { pageId } = await executors.newPageTool({});

      await expect(
        executors.gotoTool({ pageId, url: `${site.baseUrl}/products/footwear-1` })
      ).resolves.toEqual({ status: 200, ok: true });
      await expect(executors.contentTool({ pageId })).resolves.toContain('Red Sneakers');
    });

    it('shows ten products per category page', async () => {
      const { pageId } = await executors.newPageTool({});
      await executors.gotoTool({ pageId, url: `${site.baseUrl}/categories/footwear?page=1` });
      const firstPage = await executors.contentTool({ pageId });

      expect(firstPage.match(/class="product-card"/g)).toHaveLength(10);
      expect(firstPage).toContain('Page 1 of 2');

      await executors.gotoTool({ pageId, url: `${site.baseUrl}/categories/footwear?page=2` });
      const secondPage = await executors.contentTool({ pageId });
      expect(secondPage.match(/class="product-card"/g)).toHaveLength(2);
      expect(secondPage).toContain('Page 2 of 2');
    });

    it('searches product names using a case-insensitive substring', async () => {
      const { pageId } = await executors.newPageTool({});
      await executors.gotoTool({ pageId, url: `${site.baseUrl}/search?q=SNEAKERS` });
      const content = await executors.contentTool({ pageId });

      expect(content).toContain('Red Sneakers');
      expect(content).toContain('Canvas Sneakers');
      expect(content).toContain('High-Top Sneakers');
      expect(content).not.toContain('Trail Boots');
    });

    it('waits for selectors and clicks elements', async () => {
      const { pageId } = await executors.newPageTool({});
      await executors.gotoTool({ pageId, url: `${site.baseUrl}/` });

      await expect(
        executors.waitForSelectorTool({
          pageId,
          selector: '#delayed-offer',
          timeout: 1_000,
        })
      ).resolves.toEqual({ found: true });
      await expect(
        executors.clickTool({ pageId, selector: '#add-to-cart', timeout: 1_000 })
      ).resolves.toEqual({ ok: true });

      const content = await executors.contentTool({ pageId });
      expect(content).toContain('data-cart-updated="true"');
      expect(content).toContain('<span id="cart-count">1</span>');
    });
  });

  describe('browser caching integration', () => {
    let tools: Awaited<ReturnType<typeof createBrowserTools>>;

    const execute = async (name: string, input: Record<string, any> = {}): Promise<any> => {
      const tool = tools[`browserTools_${name}Tool`];
      if (!tool?.execute) {
        throw new Error(`Missing executable browser tool: ${name}`);
      }
      return tool.execute(input, {} as any);
    };

    beforeEach(async () => {
      const cache = new BrowserToolCache(new MemoryCache());
      tools = await createBrowserTools(cache);
      site.resetRequests();
    });

    afterEach(async () => {
      await closeBrowserTools();
    });

    it('serves a complete cached sequence without revisiting the site', async () => {
      const firstPage = await execute('newPage');
      const firstGoto = await execute('goto', {
        pageId: firstPage.pageId,
        url: `${site.baseUrl}/products/footwear-1`,
      });
      const firstContent = await execute('content', { pageId: firstPage.pageId });
      expect(site.requestCount('/products/footwear-1')).toBe(1);

      const secondPage = await execute('newPage');
      const secondGoto = await execute('goto', {
        pageId: secondPage.pageId,
        url: `${site.baseUrl}/products/footwear-1`,
      });
      const secondContent = await execute('content', { pageId: secondPage.pageId });

      expect(secondGoto).toEqual(firstGoto);
      expect(secondContent).toBe(firstContent);
      expect(site.requestCount('/products/footwear-1')).toBe(1);
    });

    it('replays the cached prefix once when switching to live execution', async () => {
      const warmPage = await execute('newPage');
      await execute('goto', {
        pageId: warmPage.pageId,
        url: `${site.baseUrl}/`,
      });
      expect(site.requestCount('/')).toBe(1);

      const replayedPage = await execute('newPage');
      await execute('goto', {
        pageId: replayedPage.pageId,
        url: `${site.baseUrl}/`,
      });
      expect(site.requestCount('/')).toBe(1);

      await execute('click', {
        pageId: replayedPage.pageId,
        selector: '#add-to-cart',
        timeout: 1_000,
      });
      expect(site.requestCount('/')).toBe(2);

      const firstContent = await execute('content', { pageId: replayedPage.pageId });
      const secondContent = await execute('content', { pageId: replayedPage.pageId });

      expect(firstContent).toContain('data-cart-updated="true"');
      expect(secondContent).toBe(firstContent);
      expect(site.requestCount('/')).toBe(2);
    });
  });
});
