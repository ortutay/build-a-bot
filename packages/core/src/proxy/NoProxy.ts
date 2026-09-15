import { Proxy, type ProxyRequest } from './Proxy.js';

export class NoProxy extends Proxy {
  readonly type = 'http' as const;

  constructor() {
    super('none');
  }

  async fetch(
    url: string,
    headers: HeadersInit = {},
    options: ProxyRequest = {}
  ): Promise<Response> {
    return fetch(url, { ...options, headers });
  }
}
