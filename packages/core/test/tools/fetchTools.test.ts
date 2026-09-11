import { beforeEach, describe, expect, it } from 'vitest';
import { createGlobalContext } from '../../src/context/index.js';
import { DocumentLibrary } from '../../src/documents/index.js';
import { asJSONSchema } from '../../src/mastra/instruments/shared.js';
import { createTools as createDocumentTools } from '../../src/mastra/tools/documents/tools.js';
import {
  createTools as createFetchTools,
  executors,
} from '../../src/mastra/tools/fetchTools/tools.js';
import { CdpProxy, NoProxy, ProxyRegistry } from '../../src/proxy/index.js';

const uniqueUrl = (path: string): string => {
  const url = new URL(path, 'https://httpbin.org');
  url.searchParams.set('test', crypto.randomUUID());
  return url.href;
};

const htmlUrl = (html: string): string =>
  uniqueUrl(`/base64/${encodeURIComponent(Buffer.from(html).toString('base64'))}`);

const execute = async (tools: Record<string, any>, name: string, input: Record<string, string>) => {
  const tool = tools[`${name}Tool`];
  if (!tool?.execute) throw new Error(`Missing executable tool: ${name}`);
  const result = await tool.execute(input, {} as any);
  if (typeof result !== 'object' || result === null || !('instruments' in result)) {
    throw new Error(`Tool did not return instrument metrics: ${name}`);
  }
  return result as Record<string, any>;
};

describe('fetch tool registry configuration', () => {
  it('derives HTTP proxy names from each injected registry', async () => {
    const documentLibrary = new DocumentLibrary();
    const proxyRegistry = new ProxyRegistry([
      new NoProxy(),
      new CdpProxy('browser', 'wss://browser.example.test'),
    ]);
    const tools = await createFetchTools({ documentLibrary, proxyRegistry });
    const schema = asJSONSchema(tools.fetchTool.inputSchema!, 'input') as any;
    expect(schema.properties.proxy.enum).toEqual(['none']);
    expect(await createFetchTools({ documentLibrary, proxyRegistry: new ProxyRegistry() })).toEqual(
      {}
    );
  });

  it('rejects missing proxies and browser-only proxies before fetching', async () => {
    const documentLibrary = new DocumentLibrary();
    const proxyRegistry = new ProxyRegistry([
      new CdpProxy('browser', 'wss://browser.example.test'),
    ]);
    const url = 'https://example.test';
    await expect(
      executors.fetchTool(documentLibrary, proxyRegistry, { url, proxy: 'missing' })
    ).rejects.toThrow('Unknown proxy: missing');
    await expect(
      executors.fetchTool(documentLibrary, proxyRegistry, { url, proxy: 'browser' })
    ).rejects.toThrow('does not support fetch');
  });
});

describe('fetch tools (NoProxy)', () => {
  let proxyRegistry: ProxyRegistry;
  let documentLibrary: DocumentLibrary;
  let fetchTools: Awaited<ReturnType<typeof createFetchTools>>;
  let documentTools: Awaited<ReturnType<typeof createDocumentTools>>;

  beforeEach(async () => {
    proxyRegistry = new ProxyRegistry([new NoProxy()]);
    documentLibrary = new DocumentLibrary();
    fetchTools = await createFetchTools({ documentLibrary, proxyRegistry });
    documentTools = await createDocumentTools({ documentLibrary });
  });

  it('fetches an HTTP error response with top-level fields and runtime metadata', async () => {
    const url = uniqueUrl('/status/404');
    const result = await execute(fetchTools, 'fetch', { url, proxy: 'none' });
    expect(result).toMatchObject({
      url,
      ok: false,
      status: 404,
      documentId: expect.stringMatching(/^doc:/),
      instruments: { metrics: { runtime: expect.any(Number) } },
    });
    expect(result).not.toHaveProperty('output');
  }, 120_000);

  it('uses the response URL for saved documents', async () => {
    const url = htmlUrl('<p>Fetched without a proxy</p>');
    const result = await execute(fetchTools, 'fetch', { url, proxy: 'none' });
    expect(result.ok).toBe(true);
    expect(result.url).toBe(url);
    expect(documentLibrary.get({ documentId: result.documentId })?.url).toBe(url);
  }, 120_000);

  it('saves fetched content for document tools to retrieve', async () => {
    const body = '<html><body><h1>Product</h1></body></html>';
    const url = htmlUrl(body);
    const fetched = await execute(fetchTools, 'fetch', { url, proxy: 'none' });
    const viewed = await execute(documentTools, 'documentTools_get', {
      documentId: fetched.documentId,
      format: 'raw',
      transform: 'none',
    });
    expect(viewed).toMatchObject({
      origin: 'dynamic',
      status: 200,
      request: {
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        headers: {},
        proxy: 'none',
        mode: 'fetch',
      },
      content: body,
      instruments: { metrics: { runtime: expect.any(Number) } },
    });
  }, 120_000);

  it('returns slim HTML without scripts and with resolved links', async () => {
    const url = htmlUrl(
      '<html><body><script>secret()</script><a class="item" href="/product/1">One</a></body></html>'
    );
    const fetched = await execute(fetchTools, 'fetch', { url, proxy: 'none' });
    const viewed = await execute(documentTools, 'documentTools_get', {
      documentId: fetched.documentId,
      format: 'slimHtml',
      transform: 'none',
    });
    expect(viewed.content).toContain('https://httpbin.org/product/1');
    expect(viewed.content).not.toContain('secret()');
  }, 120_000);

  it('returns the cached document for repeated fetches', async () => {
    const url = htmlUrl('<p>Catalog</p>');
    const first = await execute(fetchTools, 'fetch', { url, proxy: 'none' });
    const second = await execute(fetchTools, 'fetch', { url, proxy: 'none' });
    expect(second.documentId).toBe(first.documentId);
    expect(first.instruments.metrics.cache.result).toBe('miss');
    expect(second.instruments.metrics.cache.result).toBe('hit');
  }, 120_000);

  it('passes the context registry and document library through Mastra to fetch tools', async () => {
    const context = await createGlobalContext({ documentLibrary, proxyRegistry });
    try {
      const url = htmlUrl('<p>Context-owned document</p>');
      const tools = { fetchTool: context.mastra.getTool('fetchTool') };
      const fetched = await execute(tools, 'fetch', { url, proxy: 'none' });
      expect(context.proxyRegistry).toBe(proxyRegistry);
      expect(context.documentLibrary).toBe(documentLibrary);
      expect(documentLibrary.get({ documentId: fetched.documentId })?.content).toBe(
        '<p>Context-owned document</p>'
      );
    } finally {
      await context.mastra.shutdown();
    }
  }, 120_000);

  it('rejects unknown document IDs', async () => {
    await expect(
      execute(documentTools, 'documentTools_get', {
        documentId: 'doc:missing',
        format: 'raw',
        transform: 'none',
      })
    ).rejects.toThrow('Unknown document ID: doc:missing');
  });
});
