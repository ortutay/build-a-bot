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
import { BrightDataRequestProxy, HttpProxy, isHttpProxy, type Proxy } from './proxy/index.js';

export type ProxyName = 'datacenterDedicated' | 'datacenterShared' | 'residential' | 'unblock';

const requireSetting = (proxy: ProxyName, name: string, val: string | undefined): string => {
  if (!val) {
    throw new Error(`Proxy tier "${proxy}" requires ${name} to be configured.`);
  }
  return val;
};

const proxies: Record<ProxyName, Proxy> = {
  datacenterDedicated: new HttpProxy('datacenterDedicated', {
    password: proxyDatacenterDedicatedPassword,
    server: proxyDatacenterDedicatedServer,
    username: proxyDatacenterDedicatedUsername,
  }),
  datacenterShared: new HttpProxy('datacenterShared', {
    password: proxyDatacenterSharedPassword,
    server: proxyDatacenterSharedServer,
    username: proxyDatacenterSharedUsername,
  }),
  residential: new HttpProxy('residential', {
    password: proxyResidentialPassword,
    server: proxyResidentialServer,
    username: proxyResidentialUsername,
  }),
  unblock: new BrightDataRequestProxy('unblock', {
    apiKey: proxyUnblockToken,
    requestUrl: proxyUnblockApiUrl,
    zone: proxyUnblockZone,
  }),
};

export const names: ProxyName[] = Object.keys(proxies) as ProxyName[];

const isProxyName = (proxy: string): proxy is ProxyName => names.includes(proxy as ProxyName);

export const getProxySpec = (proxy: string = 'dedicated'): Proxy => {
  if (!isProxyName(proxy)) {
    throw new Error(`Unexpected proxy tier: ${proxy}`);
  }

  return proxies[proxy];
};

export const proxyFetch = async (
  url: string,
  proxy: string = 'dedicated',
  headers: HeadersInit = {}
): Promise<Response> => {
  const spec = getProxySpec(proxy);
  if (!isHttpProxy(spec)) {
    throw new Error(`Proxy tier "${proxy}" does not support fetch().`);
  }
  if (proxy == 'unblock') {
    requireSetting(proxy, 'PROXY_UNBLOCK_API_URL', proxyUnblockApiUrl);
    requireSetting(proxy, 'PROXY_UNBLOCK_TOKEN', proxyUnblockToken);
    requireSetting(proxy, 'PROXY_UNBLOCK_ZONE', proxyUnblockZone);
  }
  return spec.fetch(url, headers);
};
