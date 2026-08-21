import { createTool, type Tool } from '@mastra/core/tools';
import { chromium, type Browser, type Page, type Response, type Request } from 'playwright';
import { z } from 'zod';
import { DiskCache } from '../../cache/DiskCache.js';
import {
  documentContentTypes,
  documentLibrary,
  type DocumentId,
  type DocumentInput,
  type ContentType,
  type DocumentHeaders,
  type DocumentRequest,
} from '../../documents/index.js';
import { log } from '../../logger.js';
import { parseResponseBody, srid } from '../../util/index.js';

import { addInstruments, runtimeInstrument } from '../../instruments/index.js';
import { BrowserToolCache } from './BrowserToolCache.js';
import { browserCacheInstrument } from './instruments.js';
import { likelyAdOrTracker } from './block.js';

let browser: Browser | undefined;
type Cursor = {
  page: Page;
  lastResponse?: Response;
  lastRequest?: DocumentRequest;
};
const cursors: Record<string, Cursor | string> = {};

const prefix = (str: string): string => 'browserTools_' + str;

const contentTypeFromHeaders = (headers: DocumentHeaders): ContentType | null => {
  const contentType = headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  const supportedContentType = documentContentTypes.find((type) => type === contentType);
  if (!supportedContentType) {
    log.warn(`Unsupported page content type: ${contentType}`);
    return null;
    // console.log('unsupported??', headers);
    // throw new Error(`Unsupported page content type: ${contentType}`);
  }
  return supportedContentType;
};

const createCursor = async (cursorId: string | null): Promise<{ cursorId: string }> => {
  if (!cursorId) {
    cursorId = srid();
  }
  cursors[cursorId] = 'allocated';
  return { cursorId };
};

const resetCursorToAllocated = async (cursorId: string) => {
  const cursor = cursors[cursorId];
  if (cursor != 'allocated') {
    await (cursor as Cursor).page.close();
  }
  cursors[cursorId] = 'allocated';
};

const getCursor = async (cursorId: string): Promise<Cursor> => {
  let record = cursors[cursorId];
  let cursor: Cursor;

  if (record == 'allocated') {
    if (!browser) {
      browser = await chromium.launch({ headless: true });
    }
    cursor = { page: await browser.newPage() };
    cursors[cursorId] = cursor;
  } else if (record && typeof record != 'string') {
    cursor = record;
  } else {
    throw new Error(`Unknown cursor ID: ${cursorId}`);
  }

  return cursor;
};

const replay = async (cursorId: string, steps: any[]) => {
  log.info(`Browser cache replay: prefixLength=${steps.length}`);
  try {
    await createCursor(cursorId);
    for (const step of steps) {
      const toolId = step.toolId;
      const name = toolId.replace(prefix(''), '');
      const fn = executors[name];
      if (!fn) {
        throw new Error(`Could not find browser tool executor: ${name}, ${toolId}`);
      }
      await fn({ ...step.input, cursorId });
    }
  } catch (e) {
    await resetCursorToAllocated(cursorId);
    throw e;
  }
};

export const executors: Record<string, any> = {
  newPageTool: async () => createCursor(null),
  gotoTool: async ({ cursorId, url }: { cursorId: string; url: string }) => {
    const cursor = await getCursor(cursorId);
    const timestamp = new Date().toISOString();

    const documents = new Map<Request, { documentId: DocumentId; input: DocumentInput }>();
    const requestHandler = (request: Request): void => {
      if (!['fetch', 'xhr'].includes(request.resourceType())) return;
      if (likelyAdOrTracker(request)) {
        log.debug(`Ignoring likely ad or tracker: ${new URL(request.url()).host}`);
        return;
      }

      const input: DocumentInput = {
        url: request.url(),
        origin: 'dynamic',
        contentType: 'application/json',
        status: null,
        headers: {},
        request: {
          timestamp: new Date().toISOString(),
          headers: request.headers(),
          proxy: null,
          mode: 'browser',
        },
        content: '',
      };
      const documentId = documentLibrary.save(input);
      documents.set(request, { documentId, input });
    };
    const respHandler = async (resp: Response): Promise<void> => {
      const document = documents.get(resp.request());
      if (!document) return;

      const headers = await resp.allHeaders();
      const contentType = contentTypeFromHeaders(headers);
      if (!contentType) {
        return;
      }
      documentLibrary.update(document.documentId, {
        ...document.input,
        url: resp.url(),
        contentType,
        status: resp.status(),
        headers,
        content: parseResponseBody(contentType, await resp.body()),
      });
    };

    cursor.page.on('request', requestHandler);
    cursor.page.on('response', respHandler);

    const resp = await cursor.page.goto(url);

    setTimeout(() => cursor.page.off('request', requestHandler), 10);
    setTimeout(() => cursor.page.off('response', respHandler), 5_000);

    if (!resp) {
      throw new Error(`Navigation did not return a response for: ${url}`);
    }
    cursor.lastResponse = resp;
    cursor.lastRequest = {
      timestamp,
      headers: await resp.request().allHeaders(),
      proxy: null,
      mode: 'browser',
    };
    return {
      status: resp.status(),
      ok: resp.ok(),
    };
  },
  contentTool: async ({ cursorId }: { cursorId: string }) => {
    const cursor = await getCursor(cursorId);
    const content = await cursor.page.content();
    const headers: DocumentHeaders = cursor.lastResponse
      ? await cursor.lastResponse.allHeaders()
      : {};
    const documentId = documentLibrary.save({
      url: cursor.page.url(),
      origin: 'navigation',
      contentType: contentTypeFromHeaders(headers) ?? 'text/html',
      status: cursor.lastResponse?.status() ?? null,
      headers,
      request: cursor.lastRequest ?? {
        timestamp: new Date().toISOString(),
        headers: {},
        proxy: null,
        mode: 'browser',
      },
      content,
    });
    return { documentId };
  },
  waitForSelectorTool: async ({
    cursorId,
    selector,
    state,
    timeout,
  }: {
    cursorId: string;
    selector: string;
    state?: 'attached' | 'detached' | 'visible' | 'hidden';
    timeout?: number;
  }) => {
    const element = await (
      await getCursor(cursorId)
    ).page.waitForSelector(selector, {
      state,
      timeout,
    });
    return { found: element !== null };
  },
  clickTool: async ({
    cursorId,
    selector,
    index,
    timeout,
  }: {
    cursorId: string;
    selector: string;
    index?: number;
    timeout?: number;
  }) => {
    const locator = (await getCursor(cursorId)).page.locator(selector);
    await (index === undefined ? locator : locator.nth(index)).click({ timeout });
    return { ok: true };
  },
};

const newPageTool = createTool({
  id: prefix('newPageTool'),
  description: 'Launch a new browser page.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    cursorId: z.string(),
  }),
  execute: executors.newPageTool,
});

const gotoTool = createTool({
  id: prefix('gotoTool'),
  description: 'Go to a URL.',
  inputSchema: z.object({
    cursorId: z.string(),
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
  description: 'Save page content and return its document ID.',
  inputSchema: z.object({
    cursorId: z.string(),
  }),
  outputSchema: z.object({
    documentId: z.string(),
  }),
  execute: executors.contentTool,
});

const waitForSelectorTool = createTool({
  id: prefix('waitForSelectorTool'),
  description: 'Wait for an element matching a selector to reach a given state.',
  inputSchema: z.object({
    cursorId: z.string(),
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
  description:
    'Click an element matching a selector. The selector must match exactly one element unless index is provided.',
  inputSchema: z.object({
    cursorId: z.string(),
    selector: z.string(),
    index: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Zero-based index of the matching element to click.'),
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
    (
      await Promise.all(
        internal.map((tool) => addInstruments([instrument, runtimeInstrument], tool))
      )
    ).map((tool) => [tool.id, tool])
  );
};

export const closeBrowserTools = async (): Promise<void> => {
  try {
    if (browser) {
      await browser.close();
    }
  } finally {
    browser = undefined;
    for (const cursorId of Object.keys(cursors)) {
      delete cursors[cursorId];
    }
    // TODO: Add targeted page cleanup, including its browser-cache sequence.
  }
};

export const tools = await createBrowserTools(
  new BrowserToolCache(new DiskCache('/tmp/builder/BrowserToolCache'))
);
