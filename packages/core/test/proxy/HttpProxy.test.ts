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
} from '../../src/constants.js';
import { HttpProxy, type HttpProxyOptions } from '../../src/proxy/HttpProxy.js';
import { expectGeoIp, geoIpUrl } from './geo.js';

const proxyConfigs: { id: string; options: HttpProxyOptions }[] = [
  {
    id: 'datacenterDedicated',
    options: {
      password: proxyDatacenterDedicatedPassword,
      server: proxyDatacenterDedicatedServer,
      username: proxyDatacenterDedicatedUsername,
    },
  },
  {
    id: 'datacenterShared',
    options: {
      password: proxyDatacenterSharedPassword,
      server: proxyDatacenterSharedServer,
      username: proxyDatacenterSharedUsername,
    },
  },
  {
    id: 'residential',
    options: {
      password: proxyResidentialPassword,
      server: proxyResidentialServer,
      username: proxyResidentialUsername,
    },
  },
].filter(({ options }) => Boolean(options.password && options.server && options.username));

describe.runIf(proxyConfigs.length > 0)('HttpProxy', () => {
  it.each(proxyConfigs)('fetches a geo IP response through $id', async ({ id, options }) => {
    const proxy = new HttpProxy(id, options);

    await expectGeoIp(await proxy.fetch(geoIpUrl));
  });
});
