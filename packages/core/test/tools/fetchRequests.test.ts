import { expect, it, vi } from 'vitest';
import { DocumentLibrary } from '../../src/documents/index.js';
import { createTools, executors } from '../../src/mastra/tools/fetchTools/tools.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';

it('forwards read-only POST requests and caches bodies and headers independently', async () => {
  const library = new DocumentLibrary();
  const proxy = new NoProxy();
  const fetch = vi
    .spyOn(proxy, 'fetch')
    .mockImplementation(
      async () => new Response('{"jobs":[]}', { headers: { 'content-type': 'application/json' } })
    );
  const tools = await createTools({
    documentLibrary: library,
    proxyRegistry: new ProxyRegistry([proxy]),
  });
  const input = {
    url: 'https://example.test/search',
    proxy: 'none',
    method: 'POST',
    readOnly: true,
    headers: { 'content-type': 'application/json' },
    body: '{"offset":0}',
  };
  const run = (val: Record<string, unknown>) =>
    tools.fetchTool.execute!(val, {} as never) as Promise<any>;
  const first = await run(input);
  expect(fetch).toHaveBeenCalledWith(
    input.url,
    input.headers,
    expect.objectContaining({ method: 'POST', body: input.body, signal: expect.any(AbortSignal) })
  );
  expect(library.get({ documentId: first.documentId })?.request).toMatchObject({
    method: 'POST',
    body: input.body,
    headers: input.headers,
  });
  expect((await run({ ...input, _background: true })).instruments.metrics.cache.result).toBe('hit');
  await run({ ...input, body: '{"offset":20}' });
  await run({ ...input, headers: { ...input.headers, 'accept-language': 'sv' } });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('rejects mutating POST and GET bodies before sending requests', async () => {
  const proxy = new NoProxy();
  const fetch = vi.spyOn(proxy, 'fetch');
  const library = new DocumentLibrary();
  const registry = new ProxyRegistry([proxy]);
  const input = { url: 'https://example.test/search', proxy: 'none' };
  await expect(
    executors.fetchTool(library, registry, { ...input, method: 'POST' })
  ).rejects.toThrow('read-only');
  await expect(
    executors.fetchTool(library, registry, { ...input, body: 'invalid' })
  ).rejects.toThrow('GET cannot');
  expect(fetch).not.toHaveBeenCalled();
});

it('accepts null headers and body as omitted in generated GET calls', async () => {
  const proxy = new NoProxy();
  const fetch = vi.spyOn(proxy, 'fetch').mockResolvedValue(new Response('Example'));
  const tools = await createTools({
    documentLibrary: new DocumentLibrary(),
    proxyRegistry: new ProxyRegistry([proxy]),
  });
  const output = await tools.fetchTool.execute!(
    {
      url: 'https://example.test/jobs',
      proxy: 'none',
      method: 'GET',
      headers: null,
      body: null,
    },
    {} as never
  );
  expect(output).toMatchObject({ ok: true });
  expect(fetch).toHaveBeenCalledWith(
    'https://example.test/jobs',
    {},
    expect.objectContaining({ method: 'GET', body: undefined })
  );
});

it('aborts a request at its configured timeout', async () => {
  const proxy = new NoProxy();
  vi.spyOn(proxy, 'fetch').mockImplementation(
    (_url, _headers, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
          once: true,
        });
      })
  );
  await expect(
    executors.fetchTool(new DocumentLibrary(), new ProxyRegistry([proxy]), {
      url: 'https://example.test/slow',
      proxy: 'none',
      timeout: 20,
    })
  ).rejects.toThrow('timeout');
});
