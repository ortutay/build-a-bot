import "dotenv/config";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const {
  BUILDER_PROXY_DATACENTER_SERVER: datacenterServer,
  BUILDER_PROXY_DATACENTER_USERNAME: datacenterUsername,
  BUILDER_PROXY_DATACENTER_PASSWORD: datacenterPassword,
  BUILDER_PROXY_RESIDENTIAL_SERVER: residentialServer,
  BUILDER_PROXY_RESIDENTIAL_USERNAME: residentialUsername,
  BUILDER_PROXY_RESIDENTIAL_PASSWORD: residentialPassword,
  BUILDER_PROXY_RESIDENTIAL_CDP_URL: residentialCdpUrl,
  BUILDER_PROXY_UNBLOCK_API_URL: unblockApiUrl,
  BUILDER_PROXY_UNBLOCK_TOKEN: unblockToken,
  BUILDER_PROXY_UNBLOCK_ZONE: unblockZone,
} = process.env;

const none = { name: "none" };

const datacenter = {
  name: "datacenter",
  server: datacenterServer,
  username: datacenterUsername,
  password: datacenterPassword,
};

const residential = {
  name: "residential",
  server: residentialServer,
  username: residentialUsername,
  password: residentialPassword,
};

const residentialCdp = {
  name: "residentialCdp",
  cdp: residentialCdpUrl,
};

const unblock = {
  name: "unblock",
  apiUrl: unblockApiUrl,
  token: unblockToken,
  zone: unblockZone,
  fetch: async ({ url, headers = {} }) =>
    fetch(unblockApiUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Authorization: `Bearer ${unblockToken}`,
      },
      body: JSON.stringify({ zone: unblockZone, url, format: "raw" }),
      signal: AbortSignal.timeout(120_000),
    }),
};

const proxies = {
  none,
  datacenter,
  residential,
  residentialCdp,
  unblock,
};

export const getProxySpec = (proxy = "none") => {
  if (typeof proxy !== "string") {
    throw new Error("Proxy tier must be a string.");
  }

  const spec = proxies[proxy];
  if (!spec) {
    throw new Error(`Unexpected proxy tier: ${proxy}`);
  }

  if (
    proxy === "datacenter" &&
    (!datacenterServer || !datacenterUsername || !datacenterPassword)
  ) {
    throw new Error('Proxy tier "datacenter" is not configured.');
  }

  if (
    proxy === "residential" &&
    (!residentialServer || !residentialUsername || !residentialPassword)
  ) {
    throw new Error('Proxy tier "residential" is not configured.');
  }

  if (proxy === "residentialCdp" && !residentialCdpUrl) {
    throw new Error('Proxy tier "residentialCdp" is not configured.');
  }

  if (
    proxy === "unblock" &&
    (!unblockApiUrl || !unblockToken || !unblockZone)
  ) {
    throw new Error('Proxy tier "unblock" is not configured.');
  }

  return { ...spec };
};

export const proxyFetch = async (url, proxy = "none", headers = {}) => {
  const spec = getProxySpec(proxy);

  if (spec.fetch) {
    return spec.fetch({ url, headers });
  }

  if (spec.cdp) {
    throw new Error(
      'Proxy tier "residentialCdp" is only available to launchBrowser.',
    );
  }

  if (!spec.server) {
    return fetch(url, { headers });
  }

  const auth = `${encodeURIComponent(spec.username)}:${encodeURIComponent(spec.password)}`;
  const dispatcher = new ProxyAgent(`http://${auth}@${spec.server}`);
  return undiciFetch(url, { headers, dispatcher });
};
