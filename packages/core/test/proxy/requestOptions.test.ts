import { afterEach, expect, it, vi } from 'vitest';
import { BrightDataRequestProxy } from '../../src/proxy/BrightDataRequestProxy.js';
import { HttpProxy } from '../../src/proxy/HttpProxy.js';
import { NoProxy } from '../../src/proxy/NoProxy.js';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), close: vi.fn() }));
vi.mock('undici', () => ({
  fetch: mocks.fetch,
  ProxyAgent: class {
    close = mocks.close;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each([new NoProxy(), new HttpProxy('direct', {})])(
  'forwards HTTP options through $id',
  async (proxy) => {
    const fetch = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const headers = new Headers({ 'content-type': 'application/json' });
    await proxy.fetch('https://example.test', headers, { method: 'POST', body: '{}', signal });
    expect(fetch).toHaveBeenCalledWith('https://example.test', {
      method: 'POST',
      body: '{}',
      signal,
      headers,
    });
  }
);

it('forwards proxied HTTP options and closes its dispatcher after consuming the response', async () => {
  const proxy = new HttpProxy('http', {
    server: 'proxy.test:1234',
    username: 'user',
    password: 'pass',
  });
  mocks.fetch
    .mockResolvedValueOnce(new Response('ok'))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const signal = new AbortController().signal;
  expect(
    await (
      await proxy.fetch(
        'https://example.test',
        { accept: 'text/plain' },
        { method: 'POST', body: 'data', signal }
      )
    ).text()
  ).toBe('ok');
  expect(mocks.fetch).toHaveBeenCalledWith('https://example.test', {
    headers: { accept: 'text/plain' },
    method: 'POST',
    body: 'data',
    signal,
    dispatcher: expect.anything(),
  });
  expect(mocks.close).toHaveBeenCalledOnce();
  expect((await proxy.fetch('https://example.test')).body).toBeNull();
  expect(mocks.close).toHaveBeenCalledTimes(2);
});

it.each(['request', 'body'])('closes the dispatcher when the %s fails', async (phase) => {
  const proxy = new HttpProxy('http', {
    server: 'proxy.test:1234',
    username: 'user',
    password: 'pass',
  });
  const e = new Error('failed');
  if (phase === 'request') {
    mocks.fetch.mockRejectedValue(e);
  } else {
    mocks.fetch.mockResolvedValue({
      arrayBuffer: async () => {
        throw e;
      },
    });
  }
  await expect(proxy.fetch('https://example.test')).rejects.toBe(e);
  expect(mocks.close).toHaveBeenCalledOnce();
});

it('separates Bright Data API headers from target headers and honors caller cancellation', async () => {
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => new Response('ok'));
  vi.stubGlobal('fetch', fetch);
  const proxy = new BrightDataRequestProxy('bright', {
    apiKey: 'test-key',
    zone: 'test-zone',
    requestUrl: 'https://proxy.test/request',
  });
  const controller = new AbortController();
  const targetHeaders = new Headers({ authorization: 'target-token', accept: 'application/json' });
  await proxy.fetch('https://example.test', targetHeaders, {
    method: 'POST',
    body: '',
    signal: controller.signal,
  });
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('https://proxy.test/request');
  expect(options.headers).toEqual({
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-key',
  });
  expect(JSON.parse(options.body as string)).toEqual({
    zone: 'test-zone',
    url: 'https://example.test',
    format: 'raw',
    method: 'POST',
    body: '',
    headers: { authorization: 'target-token', accept: 'application/json' },
  });
  expect(options.signal!.aborted).toBe(false);
  controller.abort();
  expect(options.signal!.aborted).toBe(true);
});
