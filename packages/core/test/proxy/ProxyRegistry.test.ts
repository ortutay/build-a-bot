import { describe, expect, it } from 'vitest';
import { createGlobalContext, GlobalContext, mergeContext } from '../../src/context/index.js';
import { CdpProxy, NoProxy, ProxyRegistry } from '../../src/proxy/index.js';

describe('ProxyRegistry', () => {
  it('lists and retrieves registered proxies', () => {
    const direct = new NoProxy();
    const cdp = new CdpProxy('browser', 'wss://browser.example.test');
    const registry = new ProxyRegistry([direct, cdp]);

    expect(registry.list()).toEqual([direct, cdp]);
    expect(registry.get('browser')).toBe(cdp);
    expect(registry.require('none')).toBe(direct);
  });

  it('rejects duplicate and unknown proxy IDs', () => {
    const registry = new ProxyRegistry([new NoProxy()]);

    expect(() => registry.add(new NoProxy())).toThrow('Proxy "none" is already registered.');
    expect(() => registry.require('missing')).toThrow('Unknown proxy: missing');
    expect(() => registry.remove('missing')).toThrow('Unknown proxy: missing');
  });

  it('removes and returns a registered proxy', () => {
    const direct = new NoProxy();
    const registry = new ProxyRegistry([direct]);

    expect(registry.remove('none')).toBe(direct);
    expect(registry.list()).toEqual([]);
  });
});

describe('GlobalContext proxy registry', () => {
  const dependencies = {
    documentLibrary: {} as GlobalContext['documentLibrary'],
    mastra: {} as GlobalContext['mastra'],
    storage: {} as GlobalContext['storage'],
  };

  it('uses a registry with the direct proxy by default', async () => {
    const context = await createGlobalContext(dependencies);

    expect(context.proxyRegistry.require('none')).toBeInstanceOf(NoProxy);
  });

  it('preserves or replaces the registry when contexts merge', () => {
    const context = new GlobalContext({
      ...dependencies,
      proxyRegistry: new ProxyRegistry([new NoProxy()]),
    });
    const registry = new ProxyRegistry([new NoProxy()]);

    expect(mergeContext(context).proxyRegistry).toBe(context.proxyRegistry);
    expect(mergeContext(context, { proxyRegistry: registry }).proxyRegistry).toBe(registry);
  });

  it('uses an injected registry when creating a context', async () => {
    const registry = new ProxyRegistry([new NoProxy()]);
    const context = await createGlobalContext({ ...dependencies, proxyRegistry: registry });

    expect(context.proxyRegistry).toBe(registry);
  });
});
