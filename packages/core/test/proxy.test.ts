import { describe, it } from 'vitest';
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
} from '../src/constants.js';
import { proxyFetch, type ProxyName } from '../src/legacyProxy.js';
import { expectGeoIp, geoIpUrl } from './proxy/geo.js';

const proxyConfigs = (
  [
    {
      isConfigured: Boolean(
        proxyDatacenterDedicatedPassword &&
        proxyDatacenterDedicatedServer &&
        proxyDatacenterDedicatedUsername
      ),
      name: 'datacenterDedicated',
    },
    {
      isConfigured: Boolean(
        proxyDatacenterSharedPassword &&
        proxyDatacenterSharedServer &&
        proxyDatacenterSharedUsername
      ),
      name: 'datacenterShared',
    },
    {
      isConfigured: Boolean(
        proxyResidentialPassword && proxyResidentialServer && proxyResidentialUsername
      ),
      name: 'residential',
    },
    {
      isConfigured: Boolean(proxyUnblockApiUrl && proxyUnblockToken && proxyUnblockZone),
      name: 'unblock',
    },
  ] as { isConfigured: boolean; name: ProxyName }[]
).filter(({ isConfigured }) => isConfigured);

describe.runIf(proxyConfigs.length > 0)('legacy proxies', () => {
  it.each(proxyConfigs)('fetches a geo IP response through $name', async ({ name }) => {
    await expectGeoIp(await proxyFetch(geoIpUrl, name));
  });
});
