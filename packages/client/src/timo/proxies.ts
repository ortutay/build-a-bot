import { createBrightdataProxies, createGlobalContext, NoProxy } from '@build-a-bot/core';

export const createClientContext = async () => {
  const proxyRegistry = await createBrightdataProxies('fetchfox', [
    'datacenterShared',
    'residential',
    'residentialCdp',
    'unlock',
  ]);
  proxyRegistry.add(new NoProxy());
  console.log(
    'Configured proxies:',
    proxyRegistry.list().map((proxy) => proxy.id)
  );
  return createGlobalContext({ proxyRegistry });
};
