import { createTool } from '@mastra/core/tools';
import { chromium, type Browser, type Page } from 'playwright';
import { z } from 'zod';
import { srid } from '../../util.js';
import { type Tool, type ToolHooks } from '@mastra/core/tools';

import { addInstruments } from '../../instruments/index.js';
import { browserCacheInstrument } from './instruments.js';

let browser: Browser | undefined;
const pages: Record<string, Page> = {};

// const cache = new BrowserToolCache();

const getPage = (pageId: string): Page => {
  const page = pages[pageId];
  if (!page) {
    throw new Error(`Unknown page ID: ${pageId}`);
  }
  return page;
};

export const newPageTool = await addInstruments(
  [browserCacheInstrument],
  createTool({
    id: 'newPageTool',
    description: 'Launch a new browser page.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      pageId: z.string(),
    }),
    execute: async (inputData, ctx) => {
      if (!browser) {
        // TODO: close it
        browser = await chromium.launch({ headless: true });
      }
      const pageId = srid();
      pages[pageId] = await browser.newPage();
      return { pageId };
    },
  })
);

export const gotoTool = await addInstruments(
  [browserCacheInstrument],
  createTool({
    id: 'browserTools_gotoTool',
    description: 'Go to a URL.',
    inputSchema: z.object({
      pageId: z.string(),
      url: z.string(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      status: z.number(),
    }),
    execute: async ({ pageId, url }) => {
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
  })
);

export const contentTool = await addInstruments(
  [browserCacheInstrument],
  createTool({
    id: 'browserTools_contentTool',
    description: 'Get page content',
    inputSchema: z.object({
      pageId: z.string(),
    }),
    outputSchema: z.string(),
    execute: async ({ pageId }) => {
      return getPage(pageId).content();
    },
  })
);

export const waitForSelectorTool = await addInstruments(
  [browserCacheInstrument],
  createTool({
    id: 'browserTools_waitForSelectorTool',
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
    execute: async ({ pageId, selector, state, timeout }) => {
      const element = await getPage(pageId).waitForSelector(selector, { state, timeout });
      return { found: element !== null };
    },
  })
);

export const clickTool = await addInstruments(
  [browserCacheInstrument],
  createTool({
    id: 'browserTools_clickTool',
    description: 'Click an element matching a selector.',
    inputSchema: z.object({
      pageId: z.string(),
      selector: z.string(),
      timeout: z.number().int().positive().max(60_000).optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
    }),
    execute: async ({ pageId, selector, timeout }) => {
      await getPage(pageId).locator(selector).click({ timeout });
      return { ok: true };
    },
  })
);

type BeforeToolCall = NonNullable<ToolHooks['beforeToolCall']>;
type AfterToolCall = NonNullable<ToolHooks['afterToolCall']>;
export type MiddlewareToolHooks = Omit<ToolHooks, 'beforeToolCall' | 'afterToolCall'> & {
  beforeToolCall?: (it: Parameters<BeforeToolCall>[0], tool: Tool) => ReturnType<BeforeToolCall>;

  afterToolCall?: (it: Parameters<AfterToolCall>[0], tool: Tool) => ReturnType<AfterToolCall>;
};

export const hooks: MiddlewareToolHooks = {
  beforeToolCall: (it, tool) => {
    console.log('Browser tools beforeToolCall:', it.toolName, it, tool);
    if (!it.toolName.startsWith('browserTools_')) {
      return;
    }
    console.log('Execute the before');
  },
  afterToolCall: (it, tool) => {
    if (!it.toolName.startsWith('browserTools_')) {
      return;
    }
    console.log('Browser tools afterToolCall:', it.toolName, it, tool);
  },
};
