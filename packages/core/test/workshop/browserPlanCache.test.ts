import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentLibrary } from '../../src/documents/index.js';
import {
  closeBrowserTools,
  createTools as createBrowserTools,
} from '../../src/mastra/tools/browserTools/index.js';
import { BrowserToolCache } from '../../src/mastra/tools/browserTools/BrowserToolCache.js';
import { createTools as createDocumentTools } from '../../src/mastra/tools/documents/index.js';
import { planStep } from '../../src/mastra/workflows/steps.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { MemoryCache } from '../lib/MemoryCache.js';
import { startMockWaitHttp } from '../lib/mockWaitHttp.js';

describe('browser plan cache', () => {
  let site: Awaited<ReturnType<typeof startMockWaitHttp>>;

  beforeAll(async () => {
    site = await startMockWaitHttp();
  });

  afterAll(async () => {
    await closeBrowserTools();
    if (site) {
      await site.close();
    }
  });

  it('makes the second browser-plan run fast', async () => {
    const wait = 1_000;
    const url = `${site.baseUrl}/?wait=${wait}`;
    const tools = await createBrowserTools({
      cache: new BrowserToolCache(new MemoryCache()),
      documentLibrary,
      proxyRegistry: new ProxyRegistry([new NoProxy()]),
    });
    const documentTools = await createDocumentTools({ documentLibrary });

    const browserAgent = {
      generate: async () => {
        const newPage = tools.browserTools_newPageTool.execute;
        const goto = tools.browserTools_gotoTool.execute;
        const content = tools.browserTools_contentTool.execute;
        const getDocument = documentTools.documentTools_getTool.execute;
        if (!newPage || !goto || !content || !getDocument) {
          throw new Error('Browser planning tools are not executable');
        }

        const { cursorId } = (await newPage({}, {} as any)) as any;
        await goto({ cursorId, url }, {} as any);
        const { documentId } = (await content({ cursorId }, {} as any)) as any;
        const page = (await getDocument({ documentId }, {} as any)) as any;
        return {
          object: {
            goal: 'List catalog items.',
            modules: [],
            context: [],
            tools: [],
            report: `Use browser tools. Catalog page: ${page.content}`,
            itemSchema: { type: 'object' },
            groupings: [
              {
                groupingName: 'catalog-pages',
                groupingDescription: 'Catalog pages',
                urls: [url],
              },
            ],
          },
        };
      },
    };
    const mastra = {
      getAgentById: () => browserAgent,
    };

    const runPlan = async () => {
      const startedAt = performance.now();
      const result = await (planStep.execute as any)({
        inputData: {
          urls: [url],
          goal: 'List each catalog item with its SKU and name. This is a test of browser caching, so use browser instead of fetch().',
          itemSchema: { type: 'object' },
          modules: [],
          context: [],
          tools: [],
        },
        mastra: mastra as any,
      });
      return { elapsed: performance.now() - startedAt, result };
    };

    const first = await runPlan();
    const slowRequestsAfterFirstRun = site.requestCount(wait);
    const second = await runPlan();

    expect(first.result.report).toContain('Delayed catalog');
    expect(second.result).toEqual(first.result);
    expect(first.elapsed).toBeGreaterThanOrEqual(wait * 0.8);
    expect(slowRequestsAfterFirstRun).toBe(1);
    expect(site.requestCount(wait)).toBe(slowRequestsAfterFirstRun);
    expect(second.elapsed).toBeLessThan(wait / 2);
    expect(second.elapsed).toBeLessThan(first.elapsed);
  });
});
