import { type Proxy } from './Proxy.js';

export class ProxyRegistry {
  readonly proxies = new Map<string, Proxy>();

  constructor(proxies: Iterable<Proxy> = []) {
    for (const proxy of proxies) {
      this.add(proxy);
    }
  }

  add(proxy: Proxy): void {
    if (this.proxies.has(proxy.id)) {
      throw new Error(`Proxy "${proxy.id}" is already registered.`);
    }
    this.proxies.set(proxy.id, proxy);
  }

  get(id: string): Proxy | undefined {
    return this.proxies.get(id);
  }

  list(): Proxy[] {
    return [...this.proxies.values()];
  }

  remove(id: string): Proxy {
    const proxy = this.require(id);
    this.proxies.delete(id);
    return proxy;
  }

  require(id: string): Proxy {
    const proxy = this.get(id);
    if (!proxy) {
      throw new Error(`Unknown proxy: ${id}`);
    }
    return proxy;
  }
}
