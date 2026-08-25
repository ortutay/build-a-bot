import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowserTools, createBrowserTools } from '../../src/tools/browserTools/index.js';
import { BrowserToolCache } from '../../src/tools/browserTools/BrowserToolCache.js';
import { createDocumentTools } from '../../src/tools/documents/index.js';
import { browserPlanStep } from '../../src/workflows/steps.js';
import { MemoryCache } from '../lib/MemoryCache.js';
import { startMockWaitHttp } from '../lib/mockWaitHttp.js';

describe('browser plan cache', () => {
  let site: Awaited<ReturnType<typeof startMockWaitHttp>>;

  beforeAll(async () => {
    site = await startMockWaitHttp();
  });

  afterAll(async () => {
    await closeBrowserTools();
    if (site) await site.close();
  });

  it('makes the second browser-plan run fast', async () => {
    const wait = 1_000;
    const url = `${site.baseUrl}/?wait=${wait}`;
    const tools = await createBrowserTools(new BrowserToolCache(new MemoryCache()));
    const documentTools = await createDocumentTools();

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
        return { text: `Catalog page: ${page.content}` };
      },
    };
    const mastra = {
      getAgentById: () => browserAgent,
    };

    const runPlan = async () => {
      const startedAt = performance.now();
      const result = await (browserPlanStep.execute as any)({
        inputData: { url, goal: 'List each catalog item with its SKU and name.' },
        mastra: mastra as any,
      });
      return { elapsed: performance.now() - startedAt, result };
    };

    const first = await runPlan();
    const slowRequestsAfterFirstRun = site.requestCount(wait);
    const second = await runPlan();

    expect(first.result.report).toContain('Delayed catalog');
    expect(first.elapsed).toBeGreaterThanOrEqual(wait * 0.8);
    expect(slowRequestsAfterFirstRun).toBe(1);
    expect(site.requestCount(wait)).toBe(slowRequestsAfterFirstRun);
    expect(second.elapsed).toBeLessThan(wait / 2);
    expect(second.elapsed).toBeLessThan(first.elapsed);
  });
});
