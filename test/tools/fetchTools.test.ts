import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyFetch } = vi.hoisted(() => ({ proxyFetch: vi.fn() }));

vi.mock('../../src/proxy.js', () => ({
  names: ['unblock', 'residential'],
  proxyFetch,
}));

import { createFetchTools } from '../../src/tools/fetchTools/tools.js';

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
    text: async () => body,
  }) as Response;

describe('fetch tools', () => {
  let tools: Awaited<ReturnType<typeof createFetchTools>>;

  const execute = async (name: 'fetch' | 'viewDocument', input: Record<string, string>) => {
    const tool = tools[`${name}Tool`];
    if (!tool?.execute) {
      throw new Error(`Missing executable fetch tool: ${name}`);
    }

    const result = await tool.execute(input, {} as any);
    if (typeof result !== 'object' || result === null || !('instruments' in result)) {
      throw new Error(`Fetch tool did not return instrument metrics: ${name}`);
    }
    return result as Record<string, any>;
  };

  beforeEach(async () => {
    proxyFetch.mockReset();
    tools = await createFetchTools();
  });

  it('fetches an HTTP error response with top-level fields and runtime metadata', async () => {
    const url = 'https://example.test/missing';
    proxyFetch.mockResolvedValue(
      response({
        url,
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'text/html' },
        body: '<h1>Not found</h1>',
      })
    );

    const result = await execute('fetch', { url, proxy: 'unblock' });

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

  it('returns a saved document with headers and complete HTML', async () => {
    const url = 'https://example.test/product';
    const body = '<html><body><h1>Product</h1></body></html>';
    proxyFetch.mockResolvedValue(response({ url, headers: { 'x-product-id': '123' }, body }));

    const fetched = await execute('fetch', { url, proxy: 'unblock' });
    const viewed = await execute('viewDocument', {
      documentId: fetched.documentId,
      mode: 'html',
    });

    expect(viewed).toMatchObject({
      headers: { 'x-product-id': '123' },
      body,
      instruments: { metrics: { runtime: expect.any(Number) } },
    });
  });

  it('returns slim HTML without scripts and with resolved links', async () => {
    const url = 'https://example.test/catalog/';
    proxyFetch.mockResolvedValue(
      response({
        url,
        body: '<html><body><script>secret()</script><a class="item" href="/product/1">One</a></body></html>',
      })
    );

    const fetched = await execute('fetch', { url, proxy: 'unblock' });
    const viewed = await execute('viewDocument', {
      documentId: fetched.documentId,
      mode: 'slim',
    });

    expect(viewed.body).toContain('https://example.test/product/1');
    expect(viewed.body).not.toContain('secret()');
  });

  it('uses stable document IDs for the same URL and proxy', async () => {
    const url = 'https://example.test/catalog';
    proxyFetch.mockResolvedValue(response({ url, body: '<p>Catalog</p>' }));

    const first = await execute('fetch', { url, proxy: 'unblock' });
    const second = await execute('fetch', { url, proxy: 'unblock' });
    const differentProxy = await execute('fetch', { url, proxy: 'residential' });

    expect(second.documentId).toBe(first.documentId);
    expect(differentProxy.documentId).not.toBe(first.documentId);
  });

  it('rejects unknown document IDs', async () => {
    await expect(
      execute('viewDocument', { documentId: 'doc:missing', mode: 'html' })
    ).rejects.toThrow('Unknown document ID: doc:missing');
  });
});
