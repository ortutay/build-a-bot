import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DocumentLibrary } from '../../src/documents/index.js';
import { asJSONSchema } from '../../src/mastra/instruments/shared.js';
import { BrowserSession } from '../../src/mastra/tools/browserTools/BrowserSession.js';
import { BrowserToolCache } from '../../src/mastra/tools/browserTools/BrowserToolCache.js';
import { createTools as createBrowserTools } from '../../src/mastra/tools/browserTools/tools.js';
import { CdpProxy, HttpProxy, NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { MemoryCache } from '../lib/MemoryCache.js';
import { startMockDynamicJsonSite } from '../lib/mockDynamicJsonSite.js';
import { startMockEcommerceSite } from '../lib/mockEcommerceSite.js';

describe('browser tools with CDP proxies', () => {
  const sessions: BrowserSession[] = [];
  const createTools = async (
    options: Omit<Parameters<typeof createBrowserTools>[0], 'browserSession'>
  ) => {
    const browserSession = new BrowserSession(options.proxyRegistry);
    sessions.push(browserSession);
    return createBrowserTools({ ...options, browserSession });
  };
  const closeSessions = async () => {
    await Promise.all(sessions.splice(0).map((session) => session.close()));
  };
  let profile: string;
  let browser: BrowserContext;
  let cdpUrl: string;
  let site: Awaited<ReturnType<typeof startMockEcommerceSite>>;
  let documentLibrary: DocumentLibrary;
  let proxyRegistry: ProxyRegistry;

  beforeAll(async () => {
    profile = await mkdtemp(join(tmpdir(), 'fetchfox-cdp-'));
    browser = await chromium.launchPersistentContext(profile, {
      headless: true,
      args: ['--remote-debugging-port=0'],
    });
    const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
    cdpUrl = `http://127.0.0.1:${port}`;
    site = await startMockEcommerceSite();
  });

  beforeEach(() => {
    documentLibrary = new DocumentLibrary();
    proxyRegistry = new ProxyRegistry([
      new NoProxy(),
      new CdpProxy('remote', cdpUrl),
      new CdpProxy('remote-alias', cdpUrl),
      new HttpProxy('http-only', { server: 'http://127.0.0.1:1' }),
    ]);
    site.resetRequests();
  });

  afterEach(closeSessions);

  afterAll(async () => {
    await browser?.close();
    if (site) {
      await site.close();
    }
    if (profile) {
      await rm(profile, { recursive: true, force: true });
    }
  });

  const execute = async (
    tools: Awaited<ReturnType<typeof createTools>>,
    name: string,
    input: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ): Promise<any> => tools[`browserTools_${name}Tool`].execute!(input, context as any);

  it('lists CDP proxies and NoProxy, excluding HTTP-only proxies', async () => {
    const tools = await createTools({ documentLibrary, proxyRegistry });
    const schema = asJSONSchema(tools.browserTools_newPageTool.inputSchema!, 'input') as any;
    expect(schema.properties.proxy.enum).toEqual(['none', 'remote', 'remote-alias']);
    expect(schema.properties.proxy.default).toBe('none');
    expect(await createTools({ documentLibrary, proxyRegistry: new ProxyRegistry() })).toEqual({});
    expect(
      await createTools({
        documentLibrary,
        proxyRegistry: new ProxyRegistry([proxyRegistry.require('http-only')]),
      })
    ).toEqual({});
    const session = new BrowserSession(proxyRegistry);
    await expect(session.createCursor(null, 'http-only')).rejects.toThrow('does not support');
    await expect(session.createCursor(null, 'missing')).rejects.toThrow('Unknown proxy');
  });

  it('connects through CDP, isolates cache choices, and replays on the selected proxy', async () => {
    const tools = await createTools({
      documentLibrary,
      proxyRegistry,
      cache: new BrowserToolCache(new MemoryCache()),
    });
    const url = `${site.baseUrl}/`;
    const local = await execute(tools, 'newPage', { proxy: 'none' });
    await execute(tools, 'goto', { cursorId: local.cursorId, url });
    const remote = await execute(tools, 'newPage', { proxy: 'remote' });
    await execute(tools, 'goto', { cursorId: remote.cursorId, url });
    expect(site.requestCount('/')).toBe(2);

    const cached = await execute(tools, 'newPage', { proxy: 'remote' });
    await execute(tools, 'goto', { cursorId: cached.cursorId, url });
    expect(site.requestCount('/')).toBe(2);
    await execute(tools, 'click', { cursorId: cached.cursorId, selector: '#add-to-cart' });
    expect(site.requestCount('/')).toBe(3);
    const content = await execute(tools, 'content', { cursorId: cached.cursorId });
    expect(documentLibrary.get({ documentId: content.documentId })).toMatchObject({
      request: { proxy: 'remote', mode: 'browser' },
      content: expect.stringContaining('data-cart-updated="true"'),
    });
    const alias = await execute(tools, 'newPage', { proxy: 'remote-alias' });
    await execute(tools, 'goto', { cursorId: alias.cursorId, url });
    expect(site.requestCount('/')).toBe(4);
  });

  it('keeps matching cursor IDs in separate tool sets isolated', async () => {
    const remoteTools = await createTools({
      documentLibrary,
      proxyRegistry: new ProxyRegistry([new CdpProxy('remote', cdpUrl)]),
      cache: new BrowserToolCache(new MemoryCache()),
    });
    const localLibrary = new DocumentLibrary();
    const localTools = await createTools({
      documentLibrary: localLibrary,
      proxyRegistry: new ProxyRegistry([new NoProxy()]),
      cache: new BrowserToolCache(new MemoryCache()),
    });
    const schema = asJSONSchema(remoteTools.browserTools_newPageTool.inputSchema!, 'input') as any;
    expect(schema.properties.proxy.enum).toEqual(['remote']);
    expect(schema.required).toContain('proxy');
    const context = { toolCallId: 'same-call-id' };
    const remote = await execute(remoteTools, 'newPage', { proxy: 'remote' }, context);
    const local = await execute(localTools, 'newPage', { proxy: 'none' }, context);
    expect(remote.cursorId).toBe(local.cursorId);
    await execute(remoteTools, 'goto', {
      cursorId: remote.cursorId,
      url: `${site.baseUrl}/products/footwear-1`,
    });
    await execute(localTools, 'goto', {
      cursorId: local.cursorId,
      url: `${site.baseUrl}/categories/electronics`,
    });
    const remoteContent = await execute(remoteTools, 'content', { cursorId: remote.cursorId });
    const localContent = await execute(localTools, 'content', { cursorId: local.cursorId });
    expect(documentLibrary.get({ documentId: remoteContent.documentId })).toMatchObject({
      request: { proxy: 'remote' },
      content: expect.stringContaining('Red Sneakers'),
    });
    expect(localLibrary.get({ documentId: localContent.documentId })).toMatchObject({
      request: { proxy: 'none' },
      content: expect.stringContaining('Electronics'),
    });
  });

  it('records the selected CDP proxy on captured JSON requests', async () => {
    const dynamicSite = await startMockDynamicJsonSite();
    try {
      const tools = await createTools({
        documentLibrary,
        proxyRegistry,
        cache: new BrowserToolCache(new MemoryCache()),
      });
      const cursor = await execute(tools, 'newPage', { proxy: 'remote' });
      await execute(tools, 'goto', { cursorId: cursor.cursorId, url: `${dynamicSite.baseUrl}/` });
      await execute(tools, 'waitForSelector', {
        cursorId: cursor.cursorId,
        selector: '[data-product-id="json-widget"]',
      });
      const [document] = documentLibrary.list({
        origin: 'dynamic',
        urlPrefix: `${dynamicSite.baseUrl}/api/catalog`,
      });
      expect(documentLibrary.get({ documentId: document.id })).toMatchObject({
        request: { proxy: 'remote', mode: 'browser' },
        content: expect.stringContaining('JSON Widget'),
      });
    } finally {
      await closeSessions();
      await dynamicSite.close();
    }
  });
});
