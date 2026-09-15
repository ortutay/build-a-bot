import { type Browser } from 'playwright';

export type ProxyType = 'cdp' | 'http';

export abstract class Proxy {
  readonly id: string;

  abstract readonly type: ProxyType;

  constructor(id: string) {
    this.id = id;
  }
}

export type ProxyRequest = { method?: string; body?: string; signal?: AbortSignal | null };

export type HttpCapableProxy = Proxy & {
  readonly type: 'http';
  fetch(url: string, headers?: HeadersInit, options?: ProxyRequest): Promise<Response>;
};

export const isHttpProxy = (proxy: Proxy): proxy is HttpCapableProxy => proxy.type == 'http';

export type CdpCapableProxy = Proxy & {
  readonly type: 'cdp';
  launchBrowser(): Promise<Browser>;
};

export const isCdpProxy = (proxy: Proxy): proxy is CdpCapableProxy => proxy.type == 'cdp';
