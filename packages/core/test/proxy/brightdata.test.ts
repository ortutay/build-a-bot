import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { brightdataApiKey, deterministicRandom } from '../../src/constants.js';
import { BrightDataRequestProxy } from '../../src/proxy/BrightDataRequestProxy.js';
import { createBrightdataProxies, removeBrightdataProxies } from '../../src/proxy/provision.js';
import { srid } from '../../src/util/index.js';
import { expectGeoIp, geoIpUrl } from './geo.js';

// Run explicitly with npm run test:brightdata (ENV=integration keeps srid random).
// This suite provisions three zones and sends three small real proxy requests.
const prefix = 'a' + srid(6);
const ids = ['datacenterShared', 'residential', 'unlock'].map((type) => `${prefix}-${type}`);
const expectedNames = ['dc_shared', 'residential', 'unlock'].map(
  (suffix) => `${prefix.toLowerCase()}_${suffix}`
);

const listZones = async (): Promise<string[]> => {
  const resp = await fetch('https://api.brightdata.com/zone/get_all_zones', {
    headers: { Authorization: `Bearer ${brightdataApiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  expect(resp.ok).toBe(true);
  const zones: { name: string; status: string }[] = await resp.json();
  return zones
    .filter((zone) => zone.status !== 'deleted')
    .map((zone) => zone.name)
    .sort();
};

describe.runIf(Boolean(brightdataApiKey?.trim()))('Bright Data provisioning (real API)', () => {
  let original: string[] = [];
  let cleanupReady = false;

  beforeAll(async () => {
    expect(deterministicRandom, 'Use npm run test:brightdata for a random prefix').toBe(false);
    original = await listZones();
    expect(
      original.some((name) => name.startsWith(`${prefix}_`)),
      'Random prefix must be unused'
    ).toBe(false);
    cleanupReady = true;
  }, 180_000);

  afterAll(async () => {
    if (!cleanupReady) return;
    await removeBrightdataProxies(prefix);
    expect(await listZones()).toEqual(original);
  }, 180_000);

  it('rejects unsafe prefixes, long zone names, and missing keys', async () => {
    for (const val of ['', ' ', '*', 'fetchfoxTest-']) {
      await expect(removeBrightdataProxies(val)).rejects.toThrow('prefix');
      await expect(createBrightdataProxies(val)).rejects.toThrow('prefix');
    }
    await expect(removeBrightdataProxies(undefined as never)).rejects.toThrow('prefix');
    await expect(removeBrightdataProxies(null as never)).rejects.toThrow('prefix');
    await expect(createBrightdataProxies(prefix, [], { apiKey: '' })).rejects.toThrow('API_KEY');
    await expect(removeBrightdataProxies(prefix, { apiKey: '' })).rejects.toThrow('API_KEY');
    await expect(createBrightdataProxies(prefix.repeat(6), ['unlock'])).rejects.toThrow(
      /Could not provision Bright Data proxy .*Completed zones: none\..*30 characters/
    );
  });

  it('creates usable proxies, reuses zones, and removes only the requested prefix', async () => {
    const registry = await createBrightdataProxies(prefix);
    expect(registry.list().map((proxy) => proxy.id)).toEqual(ids);
    const names = ids.map((id) => (registry.require(id) as BrightDataRequestProxy).zone!);
    expect(names).toEqual(expectedNames);
    expect(await listZones()).toEqual([...original, ...names].sort());

    const repeated = await createBrightdataProxies(prefix);
    expect(repeated.list().map((proxy) => proxy.id)).toEqual(ids);
    expect(ids.map((id) => (repeated.require(id) as BrightDataRequestProxy).zone)).toEqual(names);
    expect(await listZones()).toEqual([...original, ...names].sort());

    const subset = await createBrightdataProxies(prefix, ['unlock', 'unlock']);
    expect(subset.list().map((proxy) => proxy.id)).toEqual([`${prefix}-unlock`]);

    for (const id of ids) {
      const proxy = registry.require(id);
      // Assert booleans, not whole instances, so failures cannot print API keys.
      expect(proxy instanceof BrightDataRequestProxy, id).toBe(true);
      await expectGeoIp(await (proxy as BrightDataRequestProxy).fetch(geoIpUrl));
    }

    expect((await removeBrightdataProxies(prefix)).sort()).toEqual([...names].sort());
    expect(await listZones()).toEqual(original);
    expect(await removeBrightdataProxies(prefix)).toEqual([]);
  }, 900_000);
});
