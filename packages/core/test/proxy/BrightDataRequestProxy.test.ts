import { describe, it } from 'vitest';
import { proxyUnblockApiUrl, proxyUnblockToken, proxyUnblockZone } from '../../src/constants.js';
import { BrightDataRequestProxy } from '../../src/proxy/BrightDataRequestProxy.js';
import { expectGeoIp, geoIpUrl } from './geo.js';

const isConfigured = Boolean(proxyUnblockApiUrl && proxyUnblockToken && proxyUnblockZone);

describe.runIf(isConfigured)('BrightDataRequestProxy', () => {
  it('fetches a geo IP response through Bright Data', async () => {
    const proxy = new BrightDataRequestProxy('unblock', {
      apiKey: proxyUnblockToken,
      requestUrl: proxyUnblockApiUrl,
      zone: proxyUnblockZone,
    });

    await expectGeoIp(await proxy.fetch(geoIpUrl));
  });
});
