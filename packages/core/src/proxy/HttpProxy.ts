import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { Proxy, type ProxyRequest } from './Proxy.js';

export type HttpProxyOptions = {
  password?: string;
  server?: string;
  username?: string;
};

export class HttpProxy extends Proxy {
  readonly type = 'http' as const;

  readonly password: string | undefined;
  readonly server: string | undefined;
  readonly username: string | undefined;

  constructor(id: string, options: HttpProxyOptions) {
    super(id);
    this.password = options.password;
    this.server = options.server;
    this.username = options.username;
  }

  async fetch(
    url: string,
    headers: HeadersInit = {},
    options: ProxyRequest = {}
  ): Promise<Response> {
    if (!this.server) {
      return fetch(url, { ...options, headers });
    }
    if (!this.username || !this.password) {
      throw new Error(`Proxy tier "${this.id}" requires a username and password.`);
    }

    const dispatcher = new ProxyAgent(
      `http://${encodeURIComponent(this.username)}:${encodeURIComponent(this.password)}@${this.server}`
    );
    try {
      const resp = await undiciFetch(url, {
        ...options,
        headers: Object.fromEntries(new Headers(headers)),
        dispatcher,
      });
      const body = await resp.arrayBuffer();
      return new Response([204, 205, 304].includes(resp.status) ? null : body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: Object.fromEntries(resp.headers),
      });
    } finally {
      await dispatcher.close();
    }
  }
}
