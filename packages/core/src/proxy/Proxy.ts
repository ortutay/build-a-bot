export type ProxyType = 'cdp' | 'http';

export abstract class Proxy {
  readonly id: string;

  abstract readonly type: ProxyType;

  constructor(id: string) {
    this.id = id;
  }
}

export type HttpCapableProxy = Proxy & {
  readonly type: 'http';
  fetch(url: string, headers?: HeadersInit): Promise<Response>;
};

export const isHttpProxy = (proxy: Proxy): proxy is HttpCapableProxy => proxy.type == 'http';
