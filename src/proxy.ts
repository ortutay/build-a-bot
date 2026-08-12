import { fetch as undiciFetch, ProxyAgent } from 'undici';
import './env.js';

export type ProxyName =
  'none' | 'datacenter' | 'residential' | 'residentialCdp' | 'unblock';

type ProxyFetchOptions = {
  url: string;
  headers?: HeadersInit;
};

type ProxyFetch = (options: ProxyFetchOptions) => Promise<Response>;

export type Proxy = {
  server?: string;
  username?: string;
  password?: string;
  cdp?: string;
  fetch?: ProxyFetch;
};

const proxies: Record<ProxyName, Proxy> = {
  none: {},
  datacenter: {
    server: process.env.PROXY_DATACENTER_SERVER,
    username: process.env.PROXY_DATACENTER_USERNAME,
    password: process.env.PROXY_DATACENTER_PASSWORD,
  },
  residential: {
    server: process.env.PROXY_RESIDENTIAL_SERVER,
    username: process.env.PROXY_RESIDENTIAL_USERNAME,
    password: process.env.PROXY_RESIDENTIAL_PASSWORD,
  },
  residentialCdp: {
    cdp: process.env.PROXY_RESIDENTIAL_CDP_URL,
  },
  unblock: {
    fetch: async ({
      url,
      headers = {},
    }: ProxyFetchOptions): Promise<Response> =>
      fetch(process.env.PROXY_UNBLOCK_API_URL!, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.PROXY_UNBLOCK_TOKEN}`,
        },
        body: JSON.stringify({
          zone: process.env.PROXY_UNBLOCK_ZONE,
          url,
          format: 'raw',
        }),
        signal: AbortSignal.timeout(120_000),
      }),
  },
};

export const names: ProxyName[] = Object.keys(proxies) as ProxyName[];

const isProxyName = (proxy: string): proxy is ProxyName =>
  names.includes(proxy as ProxyName);

export const getProxySpec = (proxy: string = 'none'): Proxy => {
  if (!isProxyName(proxy)) {
    throw new Error(`Unexpected proxy tier: ${proxy}`);
  }

  const spec = proxies[proxy];
  return { ...spec };
};

export const proxyFetch = async (
  url: string,
  proxy: string = 'none',
  headers: HeadersInit = {}
): Promise<Response> => {
  const spec = getProxySpec(proxy);

  if (spec.fetch) {
    return spec.fetch({ url, headers });
  }

  if (spec.cdp) {
    throw new Error(
      'Proxy tier "residentialCdp" is only available to launchBrowser.'
    );
  }

  if (!spec.server) {
    return fetch(url, { headers });
  }

  if (!spec.username || !spec.password) {
    throw new Error(`Proxy tier "${proxy}" requires a username and password.`);
  }

  const dispatcher = new ProxyAgent(
    `http://${encodeURIComponent(spec.username)}:${encodeURIComponent(spec.password)}@${spec.server}`
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
};
