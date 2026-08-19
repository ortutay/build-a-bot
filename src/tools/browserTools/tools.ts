import { createTool, type Tool } from '@mastra/core/tools';
import { chromium, type Browser, type Page, type LaunchOptions } from 'playwright';
import { z } from 'zod';
import { srid } from '../../util.js';

import { addInstruments } from '../../instruments/index.js';
import { browserCacheInstrument } from './instruments.js';

let browser: Browser | undefined;
const pages: Record<string, Page> = {};

const prefix = (str: string): string => 'browserTools_' + str;

const createPage = async (
  pageId: string | null,
  options: LaunchOptions | null
): Promise<{ pageId: string }> => {
  options ||= { headless: true };
  const b = await chromium.launch(options);
  // if (!browser) {
  //   // TODO: close it
  //   browser = await chromium.launch(options);
  // }

  if (!pageId) {
    pageId = srid();
  }

  pages[pageId] = await b.newPage();
  return { pageId };
};

const getPage = (pageId: string): Page => {
  const page = pages[pageId];
  if (!page) {
    throw new Error(`Unknown page ID: ${pageId}`);
  }
  return page;
};

const replay = async (pageId: string, steps: any[], context: any) => {
  console.log('Replay steps:', steps);
  await createPage(pageId, null);
  for (const step of steps) {
    const toolId = step.toolId;
    const name = toolId.replace(prefix(''), '');
    const fn = executors[name];
    if (!fn) {
      throw new Error(`Could not find brower tool executor: ${name}, ${toolId}`);
    }
    await fn({ ...step.input, pageId });
  }
};

const executors: Record<string, any> = {
  newPageTool: async () => createPage(null, null),
  gotoTool: async ({ pageId, url }: { pageId: string; url: string }) => {
    const page = getPage(pageId);
    const resp = await page.goto(url);
    if (!resp) {
      throw new Error(`Navigation did not return a response for: ${url}`);
    }
    return {
      status: resp.status(),
      ok: resp.ok(),
    };
  },
  contentTool: async ({ pageId }: { pageId: string }) => getPage(pageId).content(),
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
    const element = await getPage(pageId).waitForSelector(selector, { state, timeout });
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
    await getPage(pageId).locator(selector).click({ timeout });
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
const _instrumented: Record<string, Tool> = Object.fromEntries(
  (
    await Promise.all(
      internal.map((tool) => addInstruments([browserCacheInstrument(replay)], tool))
    )
  ).map((tool) => [tool.id, tool])
);

export const tools = _instrumented;
