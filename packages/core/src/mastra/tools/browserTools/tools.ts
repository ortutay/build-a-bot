import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import { DiskCache } from '../../../cache/DiskCache.js';
import type { GlobalContext } from '../../../context/index.js';
import {
  documentContentTypes,
  documentOrigins,
  type DocumentHeaders,
  type DocumentLibrary,
  type DocumentSummary,
} from '../../../documents/index.js';
import { log } from '../../../logger.js';
import { isCdpProxy, NoProxy, type ProxyRegistry } from '../../../proxy/index.js';
import { getOrNull, hash } from '../../../util/index.js';
import { addInstruments, markAvailableTool, runtimeInstrument } from '../../instruments/index.js';
import type { BrowserSession } from './BrowserSession.js';
import { BrowserToolCache } from './BrowserToolCache.js';
import { NetworkCapture } from './NetworkCapture.js';
import { composedHtml, frameAt, frameTree } from './dom.js';
import { inspectElements, inspectOptionsSchema, inspectResultSchema } from './elements.js';
import { browserCacheInstrument } from './instruments.js';
import { withReadiness, type Readiness } from './readiness.js';

const framePathSchema = z
  .array(z.number().int().nonnegative())
  .max(20)
  .optional()
  .describe('Frame path from framesTool; omit for main frame. Enumerate again after navigation.');

const elementTargetSchema = z.object({
  cursorId: z.string(),
  framePath: framePathSchema,
  selector: z.string().min(1).max(4096),
});
const inspectInputSchema = elementTargetSchema.extend(inspectOptionsSchema.shape);
const interactionSchema = elementTargetSchema.extend({
  timeout: z.number().int().positive().max(60_000).default(5000),
});
const pressInputSchema = interactionSchema.extend({ key: z.string().min(1).max(128) });
const fillInputSchema = interactionSchema.extend({ value: z.string().max(65536) });

export type ElementTarget = z.input<typeof elementTargetSchema>;
export type InspectElementsInput = z.input<typeof inspectInputSchema>;
export type PressInput = z.input<typeof pressInputSchema>;
export type FillInput = z.input<typeof fillInputSchema>;
export type InteractionResult = z.infer<typeof pressOutputSchema>;
export type { ElementObservation, InspectElementsResult, PropertyResult } from './elements.js';

const prefix = (str: string): string => 'browserTools_' + str;

const documentSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  origin: z.enum(documentOrigins),
  contentType: z.enum(documentContentTypes),
  status: z.number().int().nonnegative().nullable(),
  bytes: z.number().int().nonnegative(),
}) satisfies z.ZodType<DocumentSummary>;

const newPageInputSchema = z.object({ proxy: z.string().default('none') });

const newPageOutputSchema = z.object({
  cursorId: z.string(),
});

const gotoInputSchema = z.object({
  cursorId: z.string(),
  url: z.string(),
});

const readinessSchema = z.object({
  state: z.enum(['settled', 'timeout']),
  elapsedMs: z.number(),
  pending: z.number(),
}) satisfies z.ZodType<Readiness>;

const gotoOutputSchema = z.object({
  ok: z.boolean(),
  status: z.number(),
  readiness: readinessSchema,
});

const contentInputSchema = z.object({
  cursorId: z.string(),
  framePath: framePathSchema,
  shadowDom: z.boolean().default(false),
});

const contentOutputSchema = z.object({
  documentId: z.string(),
  summary: documentSummarySchema.nullable(),
});

const waitForSelectorInputSchema = z.object({
  cursorId: z.string(),
  selector: z.string(),
  framePath: framePathSchema,
  state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(),
  timeout: z.number().int().positive().max(60_000).optional(),
});

const waitForSelectorOutputSchema = z.object({
  found: z.boolean(),
});

const clickInputSchema = z.object({
  cursorId: z.string(),
  selector: z.string(),
  framePath: framePathSchema,
  index: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Zero-based index of the matching element to click.'),
  timeout: z.number().int().positive().max(60_000).optional(),
});

const clickOutputSchema = z.object({
  ok: z.boolean(),
  readiness: readinessSchema,
});

const pressOutputSchema = z.object({ ok: z.literal(true) });

const fillOutputSchema = pressOutputSchema;

const framesInputSchema = z.object({ cursorId: z.string() });

const framesOutputSchema = z.object({
  frames: z.array(z.object({ path: z.array(z.number()), url: z.string(), name: z.string() })),
});

const scrollInputSchema = z.object({
  cursorId: z.string(),
  framePath: framePathSchema,
  pixels: z.number().int().min(-5000).max(5000).default(600),
});

const scrollOutputSchema = z.object({ x: z.number(), y: z.number() });

const waitForUrlInputSchema = z.object({
  cursorId: z.string(),
  framePath: framePathSchema,
  url: z.string(),
  timeout: z.number().int().min(1).max(60000).default(5000),
});

const waitForUrlOutputSchema = z.object({ url: z.string() });

const networkInputSchema = z.object({
  cursorId: z.string(),
  urlPrefix: z.string().default(''),
  requiredUrlPrefixes: z
    .array(z.string().min(1))
    .max(20)
    .default([])
    .describe(
      'Each observed endpoint prefix must have at least one completed matching response; all waits share the timeout budget.'
    ),
  contentType: z.enum(documentContentTypes).optional(),
  minCount: z.number().int().min(0).max(200).default(0),
  timeout: z.number().int().min(1).max(60000).default(5000),
});

const networkOutputSchema = z.object({
  captureId: z.string(),
  documents: z.array(documentSummarySchema),
});

const selectInputSchema = z.object({
  cursorId: z.string(),
  selector: z.string(),
  framePath: framePathSchema,
  values: z.array(z.string()),
});

const selectOutputSchema = z.object({ selected: z.array(z.string()) });

const closeInputSchema = z.object({ cursorId: z.string() });

const closeOutputSchema = z.object({ ok: z.boolean() });

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
  inspectElementsTool: async (
    _library: DocumentLibrary,
    session: BrowserSession,
    input: z.input<typeof inspectInputSchema>
  ): Promise<z.infer<typeof inspectResultSchema>> => {
    const { cursorId, framePath, ...options } = inspectInputSchema.parse(input);
    const frame = frameAt((await session.getCursor(cursorId)).page, framePath);
    return inspectElements(frame, options);
  },
  pressTool: async (
    _library: DocumentLibrary,
    session: BrowserSession,
    input: z.input<typeof pressInputSchema>
  ): Promise<z.infer<typeof pressOutputSchema>> => {
    const { cursorId, framePath, selector, key, timeout } = pressInputSchema.parse(input);
    const frame = frameAt((await session.getCursor(cursorId)).page, framePath);
    await frame.locator(selector).press(key, { timeout });
    return { ok: true };
  },
  fillTool: async (
    _library: DocumentLibrary,
    session: BrowserSession,
    input: z.input<typeof fillInputSchema>
  ): Promise<z.infer<typeof fillOutputSchema>> => {
    const { cursorId, framePath, selector, value, timeout } = fillInputSchema.parse(input);
    const frame = frameAt((await session.getCursor(cursorId)).page, framePath);
    await frame.locator(selector).fill(value, { timeout });
    return { ok: true };
  },
  networkTool: async (
    documentLibrary: DocumentLibrary,
    session: BrowserSession,
    {
      cursorId,
      urlPrefix = '',
      requiredUrlPrefixes = [],
      minCount = 0,
      timeout = 5000,
      contentType,
    }: z.input<typeof networkInputSchema>
  ): Promise<z.infer<typeof networkOutputSchema>> => {
    const cursor = await session.getCursor(cursorId);
    const capture = NetworkCapture.for(cursor.page, documentLibrary, cursorId, cursor.proxy);
    await Promise.all([
      capture.wait(urlPrefix, minCount, timeout, contentType),
      ...requiredUrlPrefixes.map((prefix) => capture.wait(prefix, 1, timeout, contentType)),
    ]);
    return { captureId: capture.id, documents: capture.list(urlPrefix, contentType) };
  },
  framesTool: async (
    _library: DocumentLibrary,
    session: BrowserSession,
    { cursorId }: z.input<typeof framesInputSchema>
  ): Promise<z.infer<typeof framesOutputSchema>> => ({
    frames: frameTree((await session.getCursor(cursorId)).page),
  }),
  scrollTool: async (
    _library: DocumentLibrary,
    session: BrowserSession,
    { cursorId, framePath, pixels = 600 }: z.input<typeof scrollInputSchema>
  ): Promise<z.infer<typeof scrollOutputSchema>> => {
    const frame = frameAt((await session.getCursor(cursorId)).page, framePath);
    return frame.evaluate((pixels) => {
      window.scrollBy(0, pixels);
      return { x: window.scrollX, y: window.scrollY };
    }, pixels);
  },
  waitForUrlTool: async (
    _library: DocumentLibrary,
    session: BrowserSession,
    { cursorId, framePath, url, timeout = 5000 }: z.input<typeof waitForUrlInputSchema>
  ): Promise<z.infer<typeof waitForUrlOutputSchema>> => {
    const frame = frameAt((await session.getCursor(cursorId)).page, framePath);
    await frame.waitForURL(url, { timeout });
    return { url: frame.url() };
  },
  selectTool: async (
    _documentLibrary: DocumentLibrary,
    session: BrowserSession,
    { cursorId, selector, values, framePath }: z.input<typeof selectInputSchema>
  ): Promise<z.infer<typeof selectOutputSchema>> => ({
    selected: await frameAt((await session.getCursor(cursorId)).page, framePath)
      .locator(selector)
      .selectOption(values, { timeout: 5000 }),
  }),
  newPageTool: async (
    _documentLibrary: DocumentLibrary,
    session: BrowserSession,
    { proxy = 'none' }: z.input<typeof newPageInputSchema>,
    context: unknown
  ): Promise<z.infer<typeof newPageOutputSchema>> => {
    const agent = getOrNull<Record<string, unknown>>(context, 'agent');
    const toolCallId =
      getOrNull<string>(agent, 'toolCallId') ?? getOrNull<string>(context, 'toolCallId');
    return session.createCursor(toolCallId ? hash(toolCallId).slice(0, 14) : null, proxy);
  },
  gotoTool: async (
    documentLibrary: DocumentLibrary,
    session: BrowserSession,
    { cursorId, url }: z.input<typeof gotoInputSchema>
  ): Promise<z.infer<typeof gotoOutputSchema>> => {
    const cursor = await session.getCursor(cursorId);
    const timestamp = new Date().toISOString();

    const captureId = NetworkCapture.for(
      cursor.page,
      documentLibrary,
      cursorId,
      cursor.proxy
    ).begin();
    const { result: resp, readiness } = await withReadiness(cursor.page, () =>
      cursor.page.goto(url, { waitUntil: 'commit' })
    );

    if (!resp) {
      throw new Error(`Navigation did not return a response for: ${url}`);
    }
    cursor.lastResponse = resp;
    cursor.lastRequest = {
      captureId,
      cursorId,
      timestamp,
      headers: await resp.request().allHeaders(),
      proxy: cursor.proxy,
      mode: 'browser',
    };
    return {
      status: resp.status(),
      ok: resp.ok(),
      readiness,
    };
  },
  contentTool: async (
    documentLibrary: DocumentLibrary,
    session: BrowserSession,
    { cursorId, framePath, shadowDom = false }: z.input<typeof contentInputSchema>
  ): Promise<z.infer<typeof contentOutputSchema>> => {
    const cursor = await session.getCursor(cursorId);
    const frame = frameAt(cursor.page, framePath);
    const content = shadowDom ? await frame.evaluate(composedHtml) : await frame.content();
    const headers: DocumentHeaders =
      frame === cursor.page.mainFrame() && cursor.lastResponse
        ? await cursor.lastResponse.allHeaders()
        : {};
    const contentType = 'text/html' as const;
    const documentId = documentLibrary.save({
      url: frame.url(),
      origin: 'navigation',
      contentType,
      status: frame === cursor.page.mainFrame() ? (cursor.lastResponse?.status() ?? null) : null,
      headers,
      request: {
        ...(cursor.lastRequest ?? {
          timestamp: new Date().toISOString(),
          headers: {},
          proxy: cursor.proxy,
          mode: 'browser',
        }),
        frameUrl: frame.url(),
      },
      content,
    });
    return { documentId, summary: documentLibrary.summary(documentId) };
  },
  waitForSelectorTool: async (
    _documentLibrary: DocumentLibrary,
    session: BrowserSession,
    { cursorId, selector, state, framePath, timeout }: z.input<typeof waitForSelectorInputSchema>
  ): Promise<z.infer<typeof waitForSelectorOutputSchema>> => {
    const element = await frameAt(
      (await session.getCursor(cursorId)).page,
      framePath
    ).waitForSelector(selector, {
      state,
      timeout,
    });
    return { found: element !== null };
  },
  clickTool: async (
    _documentLibrary: DocumentLibrary,
    session: BrowserSession,
    { cursorId, selector, index, framePath, timeout }: z.input<typeof clickInputSchema>
  ): Promise<z.infer<typeof clickOutputSchema>> => {
    const page = (await session.getCursor(cursorId)).page;
    const locator = frameAt(page, framePath).locator(selector);
    const { readiness } = await withReadiness(page, () =>
      (index === undefined ? locator : locator.nth(index)).click({ timeout })
    );
    return { ok: true, readiness };
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
    inputSchema: newPageInputSchema.extend({
      proxy: proxyNames.includes('none') ? proxySchema.default('none') : proxySchema,
    }),
    outputSchema: newPageOutputSchema,
    execute: (...args) => executors.newPageTool(documentLibrary, session, ...args),
  });
};

const createGotoTool = (documentLibrary: DocumentLibrary, session: BrowserSession): any =>
  createTool({
    id: prefix('gotoTool'),
    description:
      'Navigate and wait for bounded DOM/dynamic-request stability. Readiness timeout is not proof of completeness; wait for an observed element or network response before reading content.',
    inputSchema: gotoInputSchema,
    outputSchema: gotoOutputSchema,
    execute: (...args) => executors.gotoTool(documentLibrary, session, ...args),
  });

const createContentTool = (documentLibrary: DocumentLibrary, session: BrowserSession): any =>
  createTool({
    id: prefix('contentTool'),
    description:
      'Save frame DOM as HTML. Set shadowDom to include open shadow roots and flattened slots; frames are separate documents with their own URLs.',
    inputSchema: contentInputSchema,
    outputSchema: contentOutputSchema,
    execute: (...args) => executors.contentTool(documentLibrary, session, ...args),
  });

const createWaitForSelectorTool = (
  documentLibrary: DocumentLibrary,
  session: BrowserSession
): any =>
  createTool({
    id: prefix('waitForSelectorTool'),
    description: 'Wait for an element matching a selector to reach a given state.',
    inputSchema: waitForSelectorInputSchema,
    outputSchema: waitForSelectorOutputSchema,
    execute: (...args) => executors.waitForSelectorTool(documentLibrary, session, ...args),
  });

const createClickTool = (documentLibrary: DocumentLibrary, session: BrowserSession): any =>
  createTool({
    id: prefix('clickTool'),
    description:
      'Click an element matching a selector. The selector must match exactly one element unless index is provided.',
    inputSchema: clickInputSchema,
    outputSchema: clickOutputSchema,
    execute: (...args) => executors.clickTool(documentLibrary, session, ...args),
  });

export type CreateBrowserToolsOptions = {
  browserSession: BrowserSession;
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
  const session = options.browserSession;
  if (session.proxyRegistry !== options.proxyRegistry) {
    throw new Error('Browser session must use the tool proxy registry');
  }
  const documentLibrary = options.documentLibrary;
  const cache =
    options.cache ??
    new BrowserToolCache(new DiskCache('BrowserToolCache'), documentLibrary.cacheScope);
  const instrument = browserCacheInstrument(
    (cursorId: string, steps: any[]) => replay(documentLibrary, session, cursorId, steps),
    cache,
    session
  );
  const internal = [
    createTool({
      id: prefix('inspectElementsTool'),
      description:
        'Read bounded DOM observations without clicking or interpreting fields. Returns original attributes, textContent, outerHTML, visibility and caller-selected primitive property values. Properties are direct names, not expressions; objects/functions are unsupported. CSS selectors pierce open shadow roots. Truncation is explicit. Does not wait for matches or establish completeness; use selector/network waits when needed. Page-defined property getters may execute.',
      inputSchema: inspectInputSchema,
      outputSchema: inspectResultSchema,
      execute: (...args) => executors.inspectElementsTool(documentLibrary, session, ...args),
    }),
    createTool({
      id: prefix('pressTool'),
      description:
        'Press the specified key or key combination on exactly one matching element. No extra keys or actions are sent. A requested Enter can submit a form. Use an explicit selector/network wait before inspecting asynchronous changes.',
      inputSchema: pressInputSchema,
      outputSchema: pressOutputSchema,
      execute: (...args) => executors.pressTool(documentLibrary, session, ...args),
    }),
    createTool({
      id: prefix('fillTool'),
      description:
        'Replace the value of exactly one matching editable element with the supplied text. Does not press Enter or select suggestions. Use an explicit selector/network wait before inspecting asynchronous changes.',
      inputSchema: fillInputSchema,
      outputSchema: fillOutputSchema,
      execute: (...args) => executors.fillTool(documentLibrary, session, ...args),
    }),
    createTool({
      id: prefix('framesTool'),
      description:
        'Enumerate all frames, including cross-origin frames, with their current paths and URLs.',
      inputSchema: framesInputSchema,
      outputSchema: framesOutputSchema,
      execute: (...args) => executors.framesTool(documentLibrary, session, ...args),
    }),
    createTool({
      id: prefix('scrollTool'),
      description: 'Scroll a frame by a bounded number of pixels to reveal lazy content.',
      inputSchema: scrollInputSchema,
      outputSchema: scrollOutputSchema,
      execute: (...args) => executors.scrollTool(documentLibrary, session, ...args),
    }),
    createTool({
      id: prefix('waitForUrlTool'),
      description: 'Wait for a frame URL (exact URL or Playwright glob) after an action.',
      inputSchema: waitForUrlInputSchema,
      outputSchema: waitForUrlOutputSchema,
      execute: (...args) => executors.waitForUrlTool(documentLibrary, session, ...args),
    }),
    createTool({
      id: prefix('networkTool'),
      description:
        'Read completed XHR/fetch documents for this cursor navigation, including responses triggered by later clicks. Wait for a URL prefix/count without arbitrary sleeps. When extraction needs multiple specific JSON endpoints, pass their observed prefixes in requiredUrlPrefixes so EVERY endpoint must arrive. A broad contentType/minCount can be satisfied by unrelated configuration responses and is not a product-data readiness check. Returns a captureId for scoped document queries.',
      inputSchema: networkInputSchema,
      outputSchema: networkOutputSchema,
      execute: (...args) => executors.networkTool(documentLibrary, session, ...args),
    }),
    createTool({
      id: prefix('selectTool'),
      description:
        'Choose native select options to reveal dependent fields. Does not submit the form.',
      inputSchema: selectInputSchema,
      outputSchema: selectOutputSchema,
      execute: (...args) => executors.selectTool(documentLibrary, session, ...args),
    }),
    createNewPageTool(documentLibrary, session),
    createGotoTool(documentLibrary, session),
    createContentTool(documentLibrary, session),
    createWaitForSelectorTool(documentLibrary, session),
    createClickTool(documentLibrary, session),
  ];
  const result = Object.fromEntries(
    (
      await Promise.all(
        internal.map((tool) =>
          addInstruments([instrument, runtimeInstrument, markAvailableTool], tool)
        )
      )
    ).map((tool) => [tool.id, tool])
  );
  result[prefix('closeTool')] = await addInstruments(
    [runtimeInstrument, markAvailableTool],
    createTool({
      id: prefix('closeTool'),
      description: 'Close a cursor and release its browser resources. This action is never cached.',
      inputSchema: closeInputSchema,
      outputSchema: closeOutputSchema,
      execute: async ({ cursorId }) => {
        await session.closeCursor(cursorId);
        delete cache.sequences[cursorId];
        return { ok: true };
      },
    })
  );
  return result;
};

export const close = async (context: GlobalContext): Promise<void> => {
  await context.browserSession.close();
};
