import './env.js';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const proxies = {
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
    fetch: async ({ url, headers = {} }) =>
      fetch(process.env.PROXY_UNBLOCK_API_URL, {
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

export const getProxySpec = (proxy = 'none') => {
  const spec = proxies[proxy];
  if (!spec) {
    throw new Error(`Unexpected proxy tier: ${proxy}`);
  }
  return { ...spec };
};

export const proxyFetch = async (url, proxy = 'none', headers = {}) => {
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

  const dispatcher = new ProxyAgent(
    `http://${encodeURIComponent(spec.username)}:${encodeURIComponent(spec.password)}@${spec.server}`
  );
  return undiciFetch(url, { headers, dispatcher });
};
