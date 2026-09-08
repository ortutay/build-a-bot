import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  proxyUnblockApiUrl: undefined as string | undefined,
  proxyUnblockToken: undefined as string | undefined,
  proxyUnblockZone: undefined as string | undefined,
}));

vi.mock('../src/constants.js', () => ({
  proxyDatacenterDedicatedPassword: undefined,
  proxyDatacenterDedicatedServer: undefined,
  proxyDatacenterDedicatedUsername: undefined,
  proxyDatacenterSharedPassword: undefined,
  proxyDatacenterSharedServer: undefined,
  proxyDatacenterSharedUsername: undefined,
  proxyResidentialPassword: undefined,
  proxyResidentialServer: undefined,
  proxyResidentialUsername: undefined,
  get proxyUnblockApiUrl() {
    return config.proxyUnblockApiUrl;
  },
  get proxyUnblockToken() {
    return config.proxyUnblockToken;
  },
  get proxyUnblockZone() {
    return config.proxyUnblockZone;
  },
}));

describe('unblock proxy', () => {
  beforeEach(() => {
    config.proxyUnblockApiUrl = undefined;
    config.proxyUnblockToken = undefined;
    config.proxyUnblockZone = undefined;
    vi.resetModules();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reports the missing setting instead of fetching an undefined endpoint', async () => {
    const { proxyFetch } = await import('../src/proxy.js');

    await expect(proxyFetch('https://example.test', 'unblock')).rejects.toThrow(
      'Proxy tier "unblock" requires PROXY_UNBLOCK_API_URL to be configured.'
    );
  });

  it('posts the target URL to the configured unblock endpoint', async () => {
    config.proxyUnblockApiUrl = 'https://unblock.example.test/request';
    config.proxyUnblockToken = 'token';
    config.proxyUnblockZone = 'zone';
    const fetchMock = vi.fn().mockResolvedValue(new Response('content'));
    vi.stubGlobal('fetch', fetchMock);
    const { proxyFetch } = await import('../src/proxy.js');

    await proxyFetch('https://example.test/page', 'unblock');

    expect(fetchMock).toHaveBeenCalledWith('https://unblock.example.test/request', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone: 'zone',
        url: 'https://example.test/page',
        format: 'raw',
      }),
      signal: expect.any(AbortSignal),
    });
  });
});
