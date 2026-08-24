import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyFetch } = vi.hoisted(() => ({ proxyFetch: vi.fn() }));

vi.mock('../../src/proxy.js', () => ({
  names: ['unblock', 'residential'],
  proxyFetch,
}));

import { createFetchTools } from '../../src/tools/fetchTools/tools.js';
import { createDocumentTools } from '../../src/tools/documents/tools.js';

const uniqueUrl = (path: string): string => `https://example.test/${path}-${crypto.randomUUID()}`;

const response = ({
  url,
  status = 200,
  statusText = 'OK',
  headers = {},
  body,
}: {
  url: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body: string;
}): Response =>
  ({
    url,
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(headers),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    text: async () => body,
  }) as Response;

describe('fetch tools', () => {
  let fetchTools: Awaited<ReturnType<typeof createFetchTools>>;
  let documentTools: Awaited<ReturnType<typeof createDocumentTools>>;

  const execute = async (
    tools: Record<string, any>,
    name: string,
    input: Record<string, string>
  ) => {
    const tool = tools[`${name}Tool`];
    if (!tool?.execute) {
      throw new Error(`Missing executable tool: ${name}`);
    }

    const result = await tool.execute(input, {} as any);
    if (typeof result !== 'object' || result === null || !('instruments' in result)) {
      throw new Error(`Tool did not return instrument metrics: ${name}`);
    }
    return result as Record<string, any>;
  };

  beforeEach(async () => {
    proxyFetch.mockReset();
    fetchTools = await createFetchTools();
    documentTools = await createDocumentTools();
  });

  it('fetches an HTTP error response with top-level fields and runtime metadata', async () => {
    const url = uniqueUrl('missing');
    proxyFetch.mockResolvedValue(
      response({
        url,
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'text/html' },
        body: '<h1>Not found</h1>',
      })
    );

    const result = await execute(fetchTools, 'fetch', { url, proxy: 'unblock' });

    expect(proxyFetch).toHaveBeenCalledWith(url, 'unblock');
    expect(result).toMatchObject({
      url,
      ok: false,
      status: 404,
      statusText: 'Not Found',
      documentId: expect.stringMatching(/^doc:/),
      instruments: { metrics: { runtime: expect.any(Number) } },
    });
    expect(result).not.toHaveProperty('output');
  });

  it('saves fetched content for document tools to retrieve', async () => {
    const url = uniqueUrl('product');
    const body = '<html><body><h1>Product</h1></body></html>';
    proxyFetch.mockResolvedValue(response({ url, headers: { 'x-product-id': '123' }, body }));

    const fetched = await execute(fetchTools, 'fetch', { url, proxy: 'unblock' });
    const viewed = await execute(documentTools, 'documentTools_get', {
      documentId: fetched.documentId,
      format: 'raw',
      transform: 'none',
    });

    expect(viewed).toMatchObject({
      origin: 'dynamic',
      headers: { 'x-product-id': '123' },
      status: 200,
      request: {
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        headers: {},
        proxy: 'unblock',
        mode: 'fetch',
      },
      content: body,
      instruments: { metrics: { runtime: expect.any(Number) } },
    });
  });

  it('returns slim HTML without scripts and with resolved links', async () => {
    const url = uniqueUrl('catalog') + '/';
    proxyFetch.mockResolvedValue(
      response({
        url,
        body: '<html><body><script>secret()</script><a class="item" href="/product/1">One</a></body></html>',
      })
    );

    const fetched = await execute(fetchTools, 'fetch', { url, proxy: 'unblock' });
    const viewed = await execute(documentTools, 'documentTools_get', {
      documentId: fetched.documentId,
      format: 'slimHtml',
      transform: 'none',
    });

    expect(viewed.content).toContain('https://example.test/product/1');
    expect(viewed.content).not.toContain('secret()');
  });

  it('returns the cached document for repeated fetches', async () => {
    const url = uniqueUrl('catalog');
    proxyFetch.mockResolvedValue(response({ url, body: '<p>Catalog</p>' }));

    const first = await execute(fetchTools, 'fetch', { url, proxy: 'unblock' });
    const second = await execute(fetchTools, 'fetch', { url, proxy: 'unblock' });
    const differentProxy = await execute(fetchTools, 'fetch', { url, proxy: 'residential' });

    expect(second.documentId).toBe(first.documentId);
    expect(differentProxy.documentId).toBe(first.documentId);
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });

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
