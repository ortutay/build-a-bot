import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { Proxy } from './Proxy.js';

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

  async fetch(url: string, headers: HeadersInit = {}): Promise<Response> {
    if (!this.server) {
      return fetch(url, { headers });
    }
    if (!this.username || !this.password) {
      throw new Error(`Proxy tier "${this.id}" requires a username and password.`);
    }

    const dispatcher = new ProxyAgent(
      `http://${encodeURIComponent(this.username)}:${encodeURIComponent(this.password)}@${this.server}`
    );
    const resp = await undiciFetch(url, {
      headers: Object.fromEntries(new Headers(headers)),
      dispatcher,
    });
    return new Response(await resp.arrayBuffer(), {
      status: resp.status,
      statusText: resp.statusText,
      headers: Object.fromEntries(resp.headers),
    });
  }
}
