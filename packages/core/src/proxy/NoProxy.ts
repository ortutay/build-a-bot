import { Proxy } from './Proxy.js';

export class NoProxy extends Proxy {
  readonly type = 'http' as const;

  constructor() {
    super('none');
  }

  async fetch(url: string, headers: HeadersInit = {}): Promise<Response> {
    return fetch(url, { headers });
  }
}
