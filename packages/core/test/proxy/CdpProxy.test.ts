import { type Browser } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import { proxyResidentialCdpUrl } from '../../src/constants.js';
import { CdpProxy } from '../../src/proxy/CdpProxy.js';
import { geoIpUrl } from './geo.js';

describe.runIf(Boolean(proxyResidentialCdpUrl))('CdpProxy', () => {
  let browser: Browser | undefined;

  afterEach(async () => browser?.close());

  it('loads a geo IP page over CDP', async () => {
    const proxy = new CdpProxy('residentialCdp', proxyResidentialCdpUrl!);
    browser = await proxy.launchBrowser();
    const page = await browser.newPage();
    const resp = await page.goto(geoIpUrl);

    expect(resp?.ok()).toBe(true);
    await expect(resp?.json()).resolves.toMatchObject({
      ip: expect.any(String),
    });
  }, 20_000);
});
