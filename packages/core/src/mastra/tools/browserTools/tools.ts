import { createTool, type Tool } from '@mastra/core/tools';
import { type Request, type Response } from 'playwright';
import { z } from 'zod';
import { DiskCache } from '../../../cache/DiskCache.js';
import {
  documentContentTypes,
  documentOrigins,
  type ContentType,
  type DocumentHeaders,
  type DocumentId,
  type DocumentInput,
  type DocumentLibrary,
  type DocumentSummary,
} from '../../../documents/index.js';
import { log } from '../../../logger.js';
import { isCdpProxy, NoProxy, type ProxyRegistry } from '../../../proxy/index.js';
import { getOrNull, hash, parseResponseBody } from '../../../util/index.js';
import { addInstruments, markAvailableTool, runtimeInstrument } from '../../instruments/index.js';
import { BrowserSession } from './BrowserSession.js';
import { BrowserToolCache } from './BrowserToolCache.js';
import { likelyAdOrTracker } from './block.js';
import { browserCacheInstrument } from './instruments.js';

const sessions = new Set<BrowserSession>();

const prefix = (str: string): string => 'browserTools_' + str;

const documentSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  origin: z.enum(documentOrigins),
  contentType: z.enum(documentContentTypes),
  status: z.number().int().nonnegative().nullable(),
  bytes: z.number().int().nonnegative(),
}) satisfies z.ZodType<DocumentSummary>;

const contentTypeFromHeaders = (headers: DocumentHeaders): ContentType | null => {
  const contentType = headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  const supportedContentType = documentContentTypes.find((type) => type === contentType);
  if (!supportedContentType) {
    log.warn(
      `Unsupported page content type: ${contentType} for headers: ${JSON.stringify(headers, null, 2)}`
    );
    return null;
    // console.log('unsupported??', headers);
    // throw new Error(`Unsupported page content type: ${contentType}`);
  }
  return supportedContentType;
};

const replay = async (
  documentLibrary: DocumentLibrary,
  session: BrowserSession,
  cursorId: string,
  steps: any[]
) => {
  log.info(`Browser cache replay: prefixLength=${steps.length}`);
  try {
    await session.resetCursor(cursorId);
    for (const step of steps) {
      const toolId = step.toolId;
      const name = toolId.replace(prefix(''), '');
      const fn = executors[name];
      if (!fn) {
        throw new Error(`Could not find browser tool executor: ${name}, ${toolId}`);
      }
      await fn(documentLibrary, session, { ...step.input, cursorId });
    }
  } catch (e) {
    await session.resetCursor(cursorId);
    throw e;
  }
};

export const executors: Record<string, any> = {
  newPageTool: async (
    _documentLibrary: DocumentLibrary,
    session: BrowserSession,
    { proxy = 'none' }: { proxy?: string },
    context: unknown
  ) => {
    sessions.add(session);
    const toolCallId = getOrNull<string>(context, 'toolCallId');
    return session.createCursor(toolCallId ? hash(toolCallId).slice(0, 14) : null, proxy);
  },
  gotoTool: async (
    documentLibrary: DocumentLibrary,
    session: BrowserSession,
    { cursorId, url }: { cursorId: string; url: string }
  ) => {
    const cursor = await session.getCursor(cursorId);
    const timestamp = new Date().toISOString();

    const documents = new Map<Request, { documentId: DocumentId; input: DocumentInput }>();
    const requestHandler = (request: Request): void => {
      if (!['fetch', 'xhr'].includes(request.resourceType())) {
        return;
      }
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
          proxy: cursor.proxy,
          mode: 'browser',
        },
        content: '',
      };
      const documentId = documentLibrary.save(input);
      documents.set(request, { documentId, input });
    };
    const respHandler = async (resp: Response): Promise<void> => {
      const document = documents.get(resp.request());
      if (!document) {
        return;
      }

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
      proxy: cursor.proxy,
      mode: 'browser',
    };
    return {
      status: resp.status(),
      ok: resp.ok(),
    };
  },
  contentTool: async (
    documentLibrary: DocumentLibrary,
    session: BrowserSession,
    { cursorId }: { cursorId: string }
  ) => {
    const cursor = await session.getCursor(cursorId);
    const content = await cursor.page.content();
    const headers: DocumentHeaders = cursor.lastResponse
      ? await cursor.lastResponse.allHeaders()
      : {};
    const contentType = contentTypeFromHeaders(headers) ?? 'text/html';
    const documentId = documentLibrary.save({
      url: cursor.page.url(),
      origin: 'navigation',
      contentType,
      status: cursor.lastResponse?.status() ?? null,
      headers,
      request: cursor.lastRequest ?? {
        timestamp: new Date().toISOString(),
        headers: {},
        proxy: cursor.proxy,
        mode: 'browser',
      },
      content,
    });
    return { documentId, summary: documentLibrary.summary(documentId) };
  },
  waitForSelectorTool: async (
    _documentLibrary: DocumentLibrary,
    session: BrowserSession,
    {
      cursorId,
      selector,
      state,
      timeout,
    }: {
      cursorId: string;
      selector: string;
      state?: 'attached' | 'detached' | 'visible' | 'hidden';
      timeout?: number;
    }
  ) => {
    const element = await (
      await session.getCursor(cursorId)
    ).page.waitForSelector(selector, {
      state,
      timeout,
    });
    return { found: element !== null };
  },
  clickTool: async (
    _documentLibrary: DocumentLibrary,
    session: BrowserSession,
    {
      cursorId,
      selector,
      index,
      timeout,
    }: {
      cursorId: string;
      selector: string;
      index?: number;
      timeout?: number;
    }
  ) => {
    const locator = (await session.getCursor(cursorId)).page.locator(selector);
    await (index === undefined ? locator : locator.nth(index)).click({ timeout });
    return { ok: true };
  },
};

const createNewPageTool = (documentLibrary: DocumentLibrary, session: BrowserSession): any => {
  const proxyNames = session.proxyRegistry
    .list()
    .filter((proxy) => isCdpProxy(proxy) || proxy instanceof NoProxy)
    .map((proxy) => proxy.id);
  const proxySchema = z.enum(proxyNames);
  return createTool({
    id: prefix('newPageTool'),
    description: 'Launch a new browser page.',
    inputSchema: z.object({
      proxy: proxyNames.includes('none') ? proxySchema.default('none') : proxySchema,
    }),
    outputSchema: z.object({
      cursorId: z.string(),
    }),
    execute: (...args) => executors.newPageTool(documentLibrary, session, ...args),
  });
};

const createGotoTool = (documentLibrary: DocumentLibrary, session: BrowserSession): any =>
  createTool({
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
    execute: (...args) => executors.gotoTool(documentLibrary, session, ...args),
  });

const createContentTool = (documentLibrary: DocumentLibrary, session: BrowserSession): any =>
  createTool({
    id: prefix('contentTool'),
    description: 'Save page content and return its document ID.',
    inputSchema: z.object({
      cursorId: z.string(),
    }),
    outputSchema: z.object({
      documentId: z.string(),
      summary: documentSummarySchema.nullable(),
    }),
    execute: (...args) => executors.contentTool(documentLibrary, session, ...args),
  });

const createWaitForSelectorTool = (
  documentLibrary: DocumentLibrary,
  session: BrowserSession
): any =>
  createTool({
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
    execute: (...args) => executors.waitForSelectorTool(documentLibrary, session, ...args),
  });

const createClickTool = (documentLibrary: DocumentLibrary, session: BrowserSession): any =>
  createTool({
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
    execute: (...args) => executors.clickTool(documentLibrary, session, ...args),
  });

export type CreateBrowserToolsOptions = {
  cache?: BrowserToolCache;
  documentLibrary: DocumentLibrary;
  proxyRegistry: ProxyRegistry;
};

export const createTools = async (
  options: CreateBrowserToolsOptions
): Promise<Record<string, Tool>> => {
  if (
    !options.proxyRegistry.list().some((proxy) => isCdpProxy(proxy) || proxy instanceof NoProxy)
  ) {
    return {};
  }
  const session = new BrowserSession(options.proxyRegistry);
  const cache = options.cache ?? new BrowserToolCache(new DiskCache('BrowserToolCache'));
  const documentLibrary = options.documentLibrary;
  const instrument = browserCacheInstrument(
    (cursorId: string, steps: any[]) => replay(documentLibrary, session, cursorId, steps),
    cache,
    session
  );
  const internal = [
    createNewPageTool(documentLibrary, session),
    createGotoTool(documentLibrary, session),
    createContentTool(documentLibrary, session),
    createWaitForSelectorTool(documentLibrary, session),
    createClickTool(documentLibrary, session),
  ];
  return Object.fromEntries(
    (
      await Promise.all(
        internal.map((tool) =>
          addInstruments([instrument, runtimeInstrument, markAvailableTool], tool)
        )
      )
    ).map((tool) => [tool.id, tool])
  );
};

export const closeBrowserTools = async (): Promise<void> => {
  const closing = [...sessions];
  sessions.clear();
  const results = await Promise.allSettled(closing.map((session) => session.close()));
  const errors = results.filter((result) => result.status === 'rejected');
  if (errors.length) {
    throw new AggregateError(errors.map((result) => result.reason));
  }
};
