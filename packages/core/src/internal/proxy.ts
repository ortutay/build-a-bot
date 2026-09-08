import { fetch as undiciFetch, ProxyAgent } from 'undici';
import {
  proxyDatacenterDedicatedPassword,
  proxyDatacenterDedicatedServer,
  proxyDatacenterDedicatedUsername,
  proxyDatacenterSharedPassword,
  proxyDatacenterSharedServer,
  proxyDatacenterSharedUsername,
  proxyResidentialPassword,
  proxyResidentialServer,
  proxyResidentialUsername,
  proxyUnblockApiUrl,
  proxyUnblockToken,
  proxyUnblockZone,
} from './constants.js';

export type ProxyName = 'datacenterDedicated' | 'datacenterShared' | 'residential' | 'unblock';
// 'residentialCdp' |

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

const requireSetting = (proxy: ProxyName, name: string, val: string | undefined): string => {
  if (!val) {
    throw new Error(`Proxy tier "${proxy}" requires ${name} to be configured.`);
  }
  return val;
};

const proxies: Record<ProxyName, Proxy> = {
  // none: {},
  datacenterDedicated: {
    server: proxyDatacenterDedicatedServer,
    username: proxyDatacenterDedicatedUsername,
    password: proxyDatacenterDedicatedPassword,
  },
  datacenterShared: {
    server: proxyDatacenterSharedServer,
    username: proxyDatacenterSharedUsername,
    password: proxyDatacenterSharedPassword,
  },
  residential: {
    server: proxyResidentialServer,
    username: proxyResidentialUsername,
    password: proxyResidentialPassword,
  },
  // residentialCdp: {
  //   cdp: proxyResidentialCdpUrl,
  // },
  unblock: {
    fetch: async ({ url, headers = {} }: ProxyFetchOptions): Promise<Response> =>
      fetch(requireSetting('unblock', 'PROXY_UNBLOCK_API_URL', proxyUnblockApiUrl), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${requireSetting('unblock', 'PROXY_UNBLOCK_TOKEN', proxyUnblockToken)}`,
        },
        body: JSON.stringify({
          zone: requireSetting('unblock', 'PROXY_UNBLOCK_ZONE', proxyUnblockZone),
          url,
          format: 'raw',
        }),
        signal: AbortSignal.timeout(120_000),
      }),
  },
};

export const names: ProxyName[] = Object.keys(proxies) as ProxyName[];

const isProxyName = (proxy: string): proxy is ProxyName => names.includes(proxy as ProxyName);

export const getProxySpec = (proxy: string = 'dedicated'): Proxy => {
  if (!isProxyName(proxy)) {
    throw new Error(`Unexpected proxy tier: ${proxy}`);
  }

  const spec = proxies[proxy];
  return { ...spec };
};

export const proxyFetch = async (
  url: string,
  proxy: string = 'dedicated',
  headers: HeadersInit = {}
): Promise<Response> => {
  const spec = getProxySpec(proxy);

  if (spec.fetch) {
    return spec.fetch({ url, headers });
  }

  if (spec.cdp) {
    throw new Error('Proxy tier "residentialCdp" is only available to launchBrowser.');
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
