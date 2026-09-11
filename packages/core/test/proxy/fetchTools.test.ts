import { beforeAll, describe, expect, it } from 'vitest';
import { brightdataApiKey } from '../../src/constants.js';
import { DocumentLibrary } from '../../src/documents/index.js';
import { createTools as createFetchTools } from '../../src/mastra/tools/fetchTools/tools.js';
import {
  BrightDataRequestProxy,
  ProxyRegistry,
  createBrightdataProxies,
  isHttpProxy,
} from '../../src/proxy/index.js';
import { expectGeoIp, geoIpUrl } from './geo.js';

describe.runIf(Boolean(brightdataApiKey?.trim()))('Bright Data proxies', () => {
  let registry: ProxyRegistry;

  beforeAll(async () => {
    // Keep the shared datacenter zone for subsequent test runs.
    registry = await createBrightdataProxies('fetchfox', ['datacenterShared']);
  }, 180_000);

  it('fetches a geo IP response through datacenterShared', async () => {
    const proxy = registry.require('fetchfox-datacenterShared');
    if (!isHttpProxy(proxy)) throw new Error(`Proxy "${proxy.id}" does not support fetch().`);
    await expectGeoIp(await proxy.fetch(geoIpUrl));
  }, 120_000);

  it('preserves the target URL and separates cached proxy choices in fetch tools', async () => {
    const shared = registry.require('fetchfox-datacenterShared') as BrightDataRequestProxy;
    const documentLibrary = new DocumentLibrary();
    // Exercise two registry IDs without provisioning another zone.
    const tools = await createFetchTools({
      documentLibrary,
      proxyRegistry: new ProxyRegistry([
        shared,
        new BrightDataRequestProxy('shared-alias', shared),
      ]),
    });
    const body = '<p>Catalog</p>';
    const url = new URL(
      `/base64/${encodeURIComponent(Buffer.from(body).toString('base64'))}`,
      'https://httpbin.org'
    );
    url.searchParams.set('test', crypto.randomUUID());
    const execute = async (proxy: string) => {
      const result = await tools.fetchTool.execute!({ url: url.href, proxy }, {} as any);
      return result as Record<string, any>;
    };
    const first = await execute(shared.id);
    const second = await execute(shared.id);
    const differentProxy = await execute('shared-alias');
    expect(first.ok).toBe(true);
    expect(first.url).toBe(url.href);
    expect(documentLibrary.get({ documentId: first.documentId })?.url).toBe(url.href);
    expect(documentLibrary.get({ documentId: first.documentId })?.content).toBe(body);
    expect(second.documentId).toBe(first.documentId);
    expect(differentProxy.documentId).toBe(first.documentId);
    expect(first.instruments.metrics.cache.result).toBe('miss');
    expect(second.instruments.metrics.cache.result).toBe('hit');
    expect(differentProxy.instruments.metrics.cache.result).toBe('miss');
  }, 120_000);
});
