import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCache } from './MemoryCache.js';

describe('MemoryCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets, gets, and deletes values', async () => {
    const cache = new MemoryCache<{ name: string }>();

    await cache.set('product/1', { name: 'Red Sneakers' });
    await expect(cache.get('product/1')).resolves.toEqual({ name: 'Red Sneakers' });

    await cache.del('product/1');
    await expect(cache.get('product/1')).resolves.toBeNull();
  });

  it('uses JSON serialization rather than retaining object references', async () => {
    const product = { name: 'Red Sneakers', details: { stock: 4 } };
    const cache = new MemoryCache<typeof product>();

    await cache.set('product', product);
    product.details.stock = 0;

    const firstRead = await cache.get('product');
    expect(firstRead).toEqual({ name: 'Red Sneakers', details: { stock: 4 } });
    if (!firstRead) {
      throw new Error('Expected cached product');
    }

    firstRead.details.stock = 2;
    await expect(cache.get('product')).resolves.toEqual({
      name: 'Red Sneakers',
      details: { stock: 4 },
    });
  });

  it('expires entries after 24 hours', async () => {
    const cache = new MemoryCache<string>();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await cache.set('product', 'Red Sneakers');

    vi.spyOn(Date, 'now').mockReturnValue(1_000 + 24 * 3600 * 1000 + 1);
    await expect(cache.get('product')).resolves.toBeNull();
  });

  it('supports read-only mode', async () => {
    const cache = new MemoryCache<string>({ readOnly: true });
    await cache.set('product', 'Red Sneakers');
    await expect(cache.get('product')).resolves.toBeNull();
  });

  it('supports write-only mode', async () => {
    const cache = new MemoryCache<string>({ writeOnly: true });
    await cache.set('product', 'Red Sneakers');
    await expect(cache.get('product')).resolves.toBeUndefined();
  });
});
