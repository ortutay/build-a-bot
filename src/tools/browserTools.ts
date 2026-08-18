import { createTool } from '@mastra/core/tools';
import { chromium, type Browser, type Page } from 'playwright';
import { z } from 'zod';
import { srid } from '../util.js';

let browser: Browser | undefined;
const pages: Record<string, Page> = {};

const getPage = (pageId: string): Page => {
  const page = pages[pageId];
  if (!page) {
    throw new Error(`Unknown page ID: ${pageId}`);
  }
  return page;
};

export const newPageTool = createTool({
  id: 'newPageTool',
  description: 'Launch a new browser page.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    pageId: z.string(),
  }),
  execute: async ({}) => {
    if (!browser) {
      // TODO: close it
      browser = await chromium.launch({ headless: true });
    }
    const pageId = srid();
    pages[pageId] = await browser.newPage();
    return { pageId };
  },
});

export const gotoTool = createTool({
  id: 'gotoTool',
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
});

export const contentTool = createTool({
  id: 'contentTool',
  description: 'Get page content',
  inputSchema: z.object({
    pageId: z.string(),
  }),
  outputSchema: z.string(),
  execute: async ({ pageId }) => {
    return getPage(pageId).content();
  },
});

export const waitForSelectorTool = createTool({
  id: 'waitForSelectorTool',
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
});

export const clickTool = createTool({
  id: 'clickTool',
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
});

// export const textContentTool = createTool({
//   id: 'textContentTool',
//   description: 'Get the text content of the first element matching a selector.',
//   inputSchema: z.object({
//     pageId: z.string(),
//     selector: z.string(),
//   }),
//   outputSchema: z.string().nullable(),
//   execute: async ({ pageId, selector }) => getPage(pageId).locator(selector).first().textContent(),
// });

// export const innerHTMLTool = createTool({
//   id: 'innerHTMLTool',
//   description: 'Get the inner HTML of the first element matching a selector.',
//   inputSchema: z.object({
//     pageId: z.string(),
//     selector: z.string(),
//   }),
//   outputSchema: z.string().nullable(),
//   execute: async ({ pageId, selector }) => getPage(pageId).locator(selector).first().innerHTML(),
// });

// export const attributeTool = createTool({
//   id: 'attributeTool',
//   description: 'Get an attribute from the first element matching a selector.',
//   inputSchema: z.object({
//     pageId: z.string(),
//     selector: z.string(),
//     name: z.string(),
//   }),
//   outputSchema: z.string().nullable(),
//   execute: async ({ pageId, selector, name }) =>
//     getPage(pageId).locator(selector).first().getAttribute(name),
// });

// export const queryAllTool = createTool({
//   id: 'queryAllTool',
//   description:
//     'Extract repeated records. Each field selector is relative to a matching root element; omit it to use the root element itself.',
//   inputSchema: z.object({
//     pageId: z.string(),
//     selector: z.string().describe('Selector for each repeated record.'),
//     fields: z.record(
//       z.string(),
//       z.object({
//         selector: z.string().optional().describe('Selector relative to each record.'),
//         attribute: z.string().optional().describe('Attribute to extract instead of text content.'),
//       })
//     ),
//   }),
//   outputSchema: z.array(z.record(z.string(), z.string().nullable())),
//   execute: async ({ pageId, selector, fields }) => {
//     const roots = getPage(pageId).locator(selector);
//     const records: Array<Record<string, string | null>> = [];

//     for (let index = 0; index < (await roots.count()); index += 1) {
//       const root = roots.nth(index);
//       const record: Record<string, string | null> = {};
//       for (const [name, field] of Object.entries(fields)) {
//         const element = field.selector ? root.locator(field.selector).first() : root;
//         record[name] = field.attribute
//           ? await element.getAttribute(field.attribute)
//           : await element.textContent();
//       }
//       records.push(record);
//     }

//     return records;
//   },
// });

// export const getLinksTool = createTool({
//   id: 'getLinksTool',
//   description: 'Get links matching a selector, with hrefs resolved against the current page URL.',
//   inputSchema: z.object({
//     pageId: z.string(),
//     selector: z.string().default('a[href]'),
//   }),
//   outputSchema: z.array(
//     z.object({
//       href: z.string(),
//       text: z.string(),
//     })
//   ),
//   execute: async ({ pageId, selector }) => {
//     const page = getPage(pageId);
//     const links: Array<{ href: string; text: string }> = [];
//     const elements = page.locator(selector);

//     for (let index = 0; index < (await elements.count()); index += 1) {
//       const element = elements.nth(index);
//       const href = await element.getAttribute('href');
//       if (href) {
//         links.push({
//           href: new URL(href, page.url()).href,
//           text: (await element.textContent()) ?? '',
//         });
//       }
//     }

//     return links;
//   },
// });
