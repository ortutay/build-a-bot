import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiskServerCache } from '../../src/mastra/extensions/cache/DiskServerCache.js';

const rootDirs: string[] = [];

const createRootDir = async (): Promise<string> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'DiskServerCache.test-'));
  rootDirs.push(rootDir);
  return rootDir;
};

const createCache = async (options: ConstructorParameters<typeof DiskServerCache>[0] = {}) => {
  const rootDir = options.rootDir ?? (await createRootDir());
  return new DiskServerCache({ ...options, rootDir });
};

describe('DiskServerCache', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(rootDirs.map((rootDir) => rm(rootDir, { force: true, recursive: true })));
    rootDirs.length = 0;
  });

  it('persists values across instances with the same key prefix', async () => {
    const rootDir = await createRootDir();
    const first = new DiskServerCache({ keyPrefix: 'test:', rootDir });
    await first.set('product', { name: 'Red Sneakers' });

    const second = new DiskServerCache({ keyPrefix: 'test:', rootDir });
    await expect(second.get('product')).resolves.toEqual({ name: 'Red Sneakers' });

    const isolated = new DiskServerCache({ keyPrefix: 'other:', rootDir });
    await expect(isolated.get('product')).resolves.toBeUndefined();
  });

  it('uses a 24-hour default TTL and accepts a per-key TTL override', async () => {
    const cache = await createCache();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await cache.set('default', 'cached');
    await cache.set('custom', 'short-lived', 100);

    vi.spyOn(Date, 'now').mockReturnValue(1_099);
    await expect(cache.get('default')).resolves.toBe('cached');
    await expect(cache.get('custom')).resolves.toBe('short-lived');

    vi.spyOn(Date, 'now').mockReturnValue(1_100);
    await expect(cache.get('custom')).resolves.toBeUndefined();

    vi.spyOn(Date, 'now').mockReturnValue(1_000 + 24 * 3600 * 1000);
    await expect(cache.get('default')).resolves.toBeUndefined();
  });

  it('supports list operations and atomically increments counters', async () => {
    const cache = await createCache();
    await cache.listPush('items', 'first');
    await cache.listPush('items', 'second');

    await expect(cache.listLength('items')).resolves.toBe(2);
    await expect(cache.listFromTo('items', 0, 0)).resolves.toEqual(['first']);
    await expect(cache.listFromTo('items', 1)).resolves.toEqual(['second']);

    const increments = await Promise.all(
      Array.from({ length: 10 }, () => cache.increment('counter'))
    );
    expect(increments.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('deletes individual entries and clears its namespace', async () => {
    const cache = await createCache();
    await cache.set('first', 'one');
    await cache.set('second', 'two');

    await cache.delete('first');
    await expect(cache.get('first')).resolves.toBeUndefined();
    await expect(cache.get('second')).resolves.toBe('two');

    await cache.clear();
    await expect(cache.get('second')).resolves.toBeUndefined();
  });
});
