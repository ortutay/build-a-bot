import { createTool, type Tool } from '@mastra/core/tools';
import { chromium, type Browser, type Page } from 'playwright';
import { z } from 'zod';
import { DiskCache } from '../../cache/DiskCache.js';
import { srid } from '../../util.js';

import { addInstruments } from '../../instruments/index.js';
import { BrowserToolCache } from './BrowserToolCache.js';
import { browserCacheInstrument } from './instruments.js';

let browser: Browser | undefined;
const pages: Record<string, Page | string> = {};

const prefix = (str: string): string => 'browserTools_' + str;

const createPage = async (pageId: string | null): Promise<{ pageId: string }> => {
  if (!pageId) {
    pageId = srid();
  }
  pages[pageId] = 'allocated';
  return { pageId };
};

const resetPageToAllocated = async (pageId: string) => {
  const page = pages[pageId];
  if (page != 'allocated') {
    await (page as Page).close();
  }
  pages[pageId] = 'allocated';
};

const getPage = async (pageId: string): Promise<Page> => {
  let record = pages[pageId];
  let page: Page;

  if (record == 'allocated') {
    if (!browser) {
      // TODO: close it
      browser = await chromium.launch({ headless: true });
    }
    page = await browser.newPage();
    pages[pageId] = page;
  } else if (record && typeof record != 'string') {
    page = record;
  } else {
    throw new Error(`Unknown page ID: ${pageId}`);
  }

  return page;
};

const replay = async (pageId: string, steps: any[], context: any) => {
  console.log('Replay steps:', steps);
  try {
    await createPage(pageId);
    for (const step of steps) {
      const toolId = step.toolId;
      const name = toolId.replace(prefix(''), '');
      const fn = executors[name];
      if (!fn) {
        throw new Error(`Could not find brower tool executor: ${name}, ${toolId}`);
      }
      await fn({ ...step.input, pageId });
    }
  } catch (e) {
    await resetPageToAllocated(pageId);
    throw e;
  }
};

export const executors: Record<string, any> = {
  newPageTool: async () => createPage(null),
  gotoTool: async ({ pageId, url }: { pageId: string; url: string }) => {
    const page = await getPage(pageId);
    const resp = await page.goto(url);
    if (!resp) {
      throw new Error(`Navigation did not return a response for: ${url}`);
    }
    return {
      status: resp.status(),
      ok: resp.ok(),
    };
  },
  contentTool: async ({ pageId }: { pageId: string }) => (await getPage(pageId)).content(),
  waitForSelectorTool: async ({
    pageId,
    selector,
    state,
    timeout,
  }: {
    pageId: string;
    selector: string;
    state?: 'attached' | 'detached' | 'visible' | 'hidden';
    timeout?: number;
  }) => {
    const element = await (await getPage(pageId)).waitForSelector(selector, { state, timeout });
    return { found: element !== null };
  },
  clickTool: async ({
    pageId,
    selector,
    timeout,
  }: {
    pageId: string;
    selector: string;
    timeout?: number;
  }) => {
    await (await getPage(pageId)).locator(selector).click({ timeout });
    return { ok: true };
  },
};

const newPageTool = createTool({
  id: prefix('newPageTool'),
  description: 'Launch a new browser page.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    pageId: z.string(),
  }),
  execute: executors.newPageTool,
});

const gotoTool = createTool({
  id: prefix('gotoTool'),
  description: 'Go to a URL.',
  inputSchema: z.object({
    pageId: z.string(),
    url: z.string(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    status: z.number(),
  }),
  execute: executors.gotoTool,
});

const contentTool = createTool({
  id: prefix('contentTool'),
  description: 'Get page content',
  inputSchema: z.object({
    pageId: z.string(),
  }),
  outputSchema: z.string(),
  execute: executors.contentTool,
});

const waitForSelectorTool = createTool({
  id: prefix('waitForSelectorTool'),
  description: 'Wait for an element matching a selector to reach a given state.',
  inputSchema: z.object({
    pageId: z.string(),
    selector: z.string(),
    state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(),
    timeout: z.number().int().positive().max(60_000).optional(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
  }),
  execute: executors.waitForSelectorTool,
});

const clickTool = createTool({
  id: prefix('clickTool'),
  description: 'Click an element matching a selector.',
  inputSchema: z.object({
    pageId: z.string(),
    selector: z.string(),
    timeout: z.number().int().positive().max(60_000).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
  }),
  execute: executors.clickTool,
});

const internal = [newPageTool, gotoTool, contentTool, waitForSelectorTool, clickTool];

export const createBrowserTools = async (
  cache: BrowserToolCache
): Promise<Record<string, Tool>> => {
  const instrument = browserCacheInstrument(replay, cache);
  return Object.fromEntries(
    (await Promise.all(internal.map((tool) => addInstruments([instrument], tool)))).map((tool) => [
      tool.id,
      tool,
    ])
  );
};

export const closeBrowserTools = async (): Promise<void> => {
  try {
    if (browser) {
      await browser.close();
    }
  } finally {
    browser = undefined;
    for (const pageId of Object.keys(pages)) {
      delete pages[pageId];
    }
  }
};

export const tools = await createBrowserTools(
  new BrowserToolCache(new DiskCache('/tmp/builder/BrowserToolCache'))
);
