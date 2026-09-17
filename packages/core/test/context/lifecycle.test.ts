import { afterEach, expect, it, vi } from 'vitest';
import { createGlobalContext, mergeContext, type GlobalContext } from '../../src/context/index.js';
import { DocumentLibrary } from '../../src/documents/index.js';
import { BrowserSession } from '../../src/mastra/tools/browserTools/BrowserSession.js';
import { BrowserToolCache } from '../../src/mastra/tools/browserTools/BrowserToolCache.js';
import { createTools } from '../../src/mastra/tools/browserTools/tools.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { MemoryCache } from '../lib/MemoryCache.js';

vi.mock('../../src/constants.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/constants.js')>()),
  mastraDatabaseFilepath: ':memory:',
  redisCacheUrl: undefined,
  tursoDatabaseUrl: undefined,
  tursoAuthToken: undefined,
}));

const contexts: GlobalContext[] = [];
const makeContext = async () => {
  const context = await createGlobalContext({ documentLibrary: new DocumentLibrary() });
  contexts.push(context);
  return context;
};

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map((context) => context.close()));
  vi.restoreAllMocks();
});

it('closes only its own pages, including matching cursor IDs in another context', async () => {
  const first = await makeContext();
  const second = await makeContext();
  const makeTools = (context: GlobalContext) =>
    createTools({
      browserSession: context.browserSession,
      documentLibrary: context.documentLibrary,
      proxyRegistry: context.proxyRegistry,
      cache: new BrowserToolCache(new MemoryCache()),
    });
  const firstTools = await makeTools(first);
  const secondTools = await makeTools(second);
  const execute = (
    tools: Awaited<ReturnType<typeof createTools>>,
    name: string,
    input: unknown = {}
  ) =>
    tools[`browserTools_${name}Tool`].execute!(input, {
      toolCallId: 'shared-id',
    } as any) as Promise<any>;
  const firstCursor = await execute(firstTools, 'newPage');
  const secondCursor = await execute(secondTools, 'newPage');
  expect(firstCursor.cursorId).toBe(secondCursor.cursorId);
  const firstPage = (await first.browserSession.getCursor(firstCursor.cursorId)).page;
  const secondPage = (await second.browserSession.getCursor(secondCursor.cursorId)).page;
  await firstPage.setContent('<p>First</p>');
  await secondPage.setContent('<p>Second</p>');

  await first.close();

  expect(firstPage.isClosed()).toBe(true);
  expect(secondPage.isClosed()).toBe(false);
  await expect(first.browserSession.getCursor(firstCursor.cursorId)).rejects.toThrow(
    'Unknown cursor'
  );
  const content = await execute(secondTools, 'content', { cursorId: secondCursor.cursorId });
  expect(second.documentLibrary.get({ documentId: content.documentId })?.content).toContain(
    'Second'
  );
  await second.close();
  expect(secondPage.isClosed()).toBe(true);
});

it('waits for shutdown, attempts tool cleanup on failure, and reuses the close result', async () => {
  const context = await makeContext();
  const shutdownError = new Error('shutdown failed');
  const toolsError = new Error('tools failed');
  let rejectShutdown!: (e: Error) => void;
  let started!: () => void;
  const shutdownStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const realShutdown = context.mastra.shutdown.bind(context.mastra);
  const shutdown = vi.spyOn(context.mastra, 'shutdown').mockImplementation(() => {
    started();
    return new Promise<void>((_resolve, reject) => {
      rejectShutdown = reject;
    });
  });
  const closeSession = vi.spyOn(context.browserSession, 'close').mockRejectedValue(toolsError);
  try {
    const closing = context.close();
    const result = closing.catch((e: unknown) => e);
    expect(context.close()).toBe(closing);
    await shutdownStarted;
    expect(closeSession).not.toHaveBeenCalled();
    rejectShutdown(shutdownError);
    const e = await result;
    expect(e).toBeInstanceOf(AggregateError);
    expect((e as AggregateError).errors).toEqual([
      shutdownError,
      expect.objectContaining({ errors: [toolsError] }),
    ]);
    expect(shutdown).toHaveBeenCalledOnce();
    expect(closeSession).toHaveBeenCalledOnce();
    expect(context.close()).toBe(closing);
  } finally {
    await realShutdown();
  }
});

it('keeps merged views from closing their owner and rejects incompatible overrides', async () => {
  const owner = await makeContext();
  const closeSession = vi.spyOn(owner.browserSession, 'close');
  const shutdown = vi.spyOn(owner.mastra, 'shutdown');
  const view = mergeContext(owner);
  expect(view.browserSession).toBe(owner.browserSession);
  await view.close();
  expect(closeSession).not.toHaveBeenCalled();
  expect(shutdown).not.toHaveBeenCalled();
  expect(() => mergeContext(owner, { proxyRegistry: new ProxyRegistry([new NoProxy()]) })).toThrow(
    'createGlobalContext'
  );
  const other = await makeContext();
  expect(() => mergeContext(owner, { mastra: other.mastra })).toThrow('createGlobalContext');
  await owner.close();
  expect(closeSession).toHaveBeenCalledOnce();
  expect(shutdown).toHaveBeenCalledOnce();
});

it('uses an injected session and removes the fallback exit listener on explicit close', async () => {
  const proxyRegistry = new ProxyRegistry([new NoProxy()]);
  const browserSession = new BrowserSession(proxyRegistry);
  const listeners = process.listenerCount('beforeExit');
  const context = await createGlobalContext({
    browserSession,
    proxyRegistry,
    documentLibrary: new DocumentLibrary(),
  });
  contexts.push(context);
  expect(context.browserSession).toBe(browserSession);
  expect(process.listenerCount('beforeExit')).toBe(listeners + 1);
  const closeSession = vi.spyOn(browserSession, 'close');
  await context.close();
  expect(closeSession).toHaveBeenCalledOnce();
  expect(process.listenerCount('beforeExit')).toBe(listeners);
  await expect(
    createGlobalContext({ browserSession, proxyRegistry: new ProxyRegistry() })
  ).rejects.toThrow('context proxy registry');
});
