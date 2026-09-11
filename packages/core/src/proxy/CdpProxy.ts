import { chromium, type Browser } from 'playwright';
import { Proxy } from './Proxy.js';

export class CdpProxy extends Proxy {
  readonly type = 'cdp' as const;

  readonly cdpUrl: string;

  constructor(id: string, cdpUrl: string) {
    super(id);
    this.cdpUrl = cdpUrl;
  }

  async launchBrowser(): Promise<Browser> {
    return chromium.connectOverCDP(this.cdpUrl);
  }
}
