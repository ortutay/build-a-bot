import { brightdataApiKey } from '../constants.js';
import { getOrNull } from '../util/index.js';
import { log } from '../logger.js';
import { BrightDataRequestProxy } from './BrightDataRequestProxy.js';
import { CdpProxy } from './CdpProxy.js';
import { ProxyRegistry } from './ProxyRegistry.js';

export type BrightdataProxyType = 'datacenterShared' | 'residential' | 'residentialCdp' | 'unlock';

export type BrightdataProvisionOptions = {
  apiKey?: string;
};

const defaultTypes: readonly BrightdataProxyType[] = ['datacenterShared', 'residential', 'unlock'];
const apiUrl = 'https://api.brightdata.com';
const zoneSuffixes: Record<BrightdataProxyType, string> = {
  datacenterShared: 'dc_shared',
  residential: 'residential',
  residentialCdp: 'residential_cdp',
  unlock: 'unlock',
};

const zoneName = (prefix: string, type: BrightdataProxyType): string => {
  const name = `${prefix.toLowerCase()}_${zoneSuffixes[type]}`;
  if (name.length > 30) {
    throw new Error('Bright Data zone names must fit within 30 characters; use a shorter prefix.');
  }
  return name;
};

const validatePrefix = (prefix: string): void => {
  if (typeof prefix !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(prefix)) {
    throw new Error(
      'Bright Data prefix must start with a letter and contain only letters, digits, or underscores.'
    );
  }
};

const requireApiKey = (apiKey: string | undefined): string => {
  if (!apiKey?.trim()) {
    throw new Error('Bright Data provisioning requires BRIGHTDATA_API_KEY or options.apiKey.');
  }
  return apiKey;
};

const request = async (
  apiKey: string,
  path: string,
  method = 'GET',
  body?: unknown
): Promise<unknown> => {
  const resp = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    const detail = text.slice(0, 500);
    throw new Error(`Bright Data ${method} ${path} failed (${resp.status}): ${detail}`);
  }
  return method === 'GET' ? JSON.parse(text) : undefined;
};

const listZones = async (apiKey: string): Promise<{ name: string; status: string }[]> => {
  // Include disabled zones so creation cannot overwrite them and cleanup can remove them.
  const zones = await request(apiKey, '/zone/get_all_zones');
  if (!Array.isArray(zones)) {
    throw new Error('Bright Data returned an invalid zone list.');
  }
  return zones.map((zone) => {
    const name = getOrNull<string>(zone, 'name');
    const status = getOrNull<string>(zone, 'status');
    if (name === null || status === null) {
      throw new Error('Bright Data returned a zone with a missing name or status.');
    }
    return { name, status };
  });
};

const planFor = (type: BrightdataProxyType) => {
  switch (type) {
    case 'datacenterShared':
      return {
        type: 'static',
        ips_type: 'shared',
        ip_alloc_preset: 'shared_block',
        bandwidth: 'payperusage',
      };
    case 'residential':
      return { type: 'resident', vips_type: 'shared' };
    case 'residentialCdp':
      return { type: 'browser_api' };
    case 'unlock':
      return { type: 'unblocker' };
  }
};

const cdpUrl = async (apiKey: string, name: string): Promise<string> => {
  const [account, zone] = await Promise.all([
    request(apiKey, '/status'),
    request(apiKey, `/zone?zone=${encodeURIComponent(name)}`),
  ]);
  const customer = getOrNull<string>(account, 'customer');
  const passwords = getOrNull<string[]>(zone, 'password');
  const password = passwords?.[0];
  if (!customer || !password) {
    throw new Error(`Bright Data returned missing CDP credentials for zone "${name}".`);
  }
  const url = new URL('wss://brd.superproxy.io:9222');
  url.username = `brd-customer-${customer}-zone-${name}`;
  url.password = password;
  return url.href;
};

export const createBrightdataProxies = async (
  prefix = 'fetchfox',
  types: readonly BrightdataProxyType[] = defaultTypes,
  options: BrightdataProvisionOptions = {}
): Promise<ProxyRegistry> => {
  validatePrefix(prefix);
  const apiKey = options.apiKey ?? brightdataApiKey;
  if (!apiKey) {
    throw new Error('Bright Data provisioning requires BRIGHTDATA_API_KEY or options.apiKey.');
  }
  const registry = new ProxyRegistry([]);
  const zones = await listZones(apiKey);
  const completed: string[] = [];
  for (const type of new Set(types)) {
    const id = `${prefix}-${type}`;
    log.info(`Provision Brightdata proxy: ${id}`);
    try {
      const name = zoneName(prefix, type);
      if (!zones.some((zone) => zone.name === name)) {
        try {
          log.info(`No zone found, creating: ${name}`);
          const plan = planFor(type);
          await request(apiKey, '/zone', 'POST', { zone: { name, type: plan.type }, plan });
        } catch (e) {
          // A timed-out create may have succeeded, or another caller created it.
          // Reconcile by name; never blindly retry a billable POST.
          // Preserve the create error if reconciliation itself is unavailable.
          const found = await listZones(apiKey)
            .then((zones) => zones.some((zone) => zone.name === name && zone.status !== 'deleted'))
            .catch(() => false);
          if (!found) {
            throw e;
          }
        }
      }
      if (type === 'residentialCdp') {
        registry.add(new CdpProxy(id, await cdpUrl(apiKey, name)));
      } else {
        registry.add(
          new BrightDataRequestProxy(id, { apiKey, requestUrl: `${apiUrl}/request`, zone: name })
        );
      }
      log.info(`Got zone: ${name}`);
      completed.push(name);
    } catch (e) {
      throw new Error(
        `Could not provision Bright Data proxy "${id}". Completed zones: ${completed.join(', ') || 'none'}. Zones may remain under prefix "${prefix}"; rerun or removeBrightdataProxies explicitly. ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return registry;
};

export const removeBrightdataProxies = async (
  prefix: string,
  options: BrightdataProvisionOptions = {}
): Promise<string[]> => {
  validatePrefix(prefix);
  const apiKey = requireApiKey(options.apiKey ?? brightdataApiKey);
  const names = (await listZones(apiKey))
    .filter((zone) => zone.status !== 'deleted' && zone.name.startsWith(`${prefix.toLowerCase()}_`))
    .map((zone) => zone.name);
  const removed: string[] = [];
  const errors: Error[] = [];
  for (const name of names) {
    try {
      // Bright Data can delete ALL zones if the zone field is omitted.
      await request(apiKey, '/zone', 'DELETE', { zone: name });
      removed.push(name);
    } catch (e) {
      errors.push(
        new Error(
          `Could not remove Bright Data zone "${name}": ${e instanceof Error ? e.message : String(e)}`
        )
      );
    }
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      `Bright Data cleanup failed. Removed zones: ${removed.join(', ') || 'none'}.`
    );
  }
  return removed;
};
