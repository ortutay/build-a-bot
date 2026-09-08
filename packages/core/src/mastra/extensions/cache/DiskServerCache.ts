import { createHash } from 'node:crypto';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { MastraServerCache } from '@mastra/core/cache';
import { DiskCache } from '../../../cache/DiskCache.js';

export type DiskServerCacheOptions = {
  keyPrefix?: string;
  lockStaleMs?: number;
  lockTimeoutMs?: number;
  rootDir?: string;
  ttlMs?: number;
};

const defaultRootDir = '.build-a-bot/mastra-disk-server-cache';
const defaultTtlMs = 24 * 3600 * 1000;
const defaultLockStaleMs = 30 * 1000;
const defaultLockTimeoutMs = 5 * 1000;
const lockRetryMs = 10;

const hasCode = (e: unknown, code: string): boolean =>
  e instanceof Error && 'code' in e && (e as { code?: unknown }).code === code;

const wait = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

export class DiskServerCache extends MastraServerCache {
  private readonly cache: DiskCache;
  private readonly keyPrefix: string;
  private readonly lockStaleMs: number;
  private readonly lockTimeoutMs: number;

  constructor({
    keyPrefix = '',
    lockStaleMs = defaultLockStaleMs,
    lockTimeoutMs = defaultLockTimeoutMs,
    rootDir = defaultRootDir,
    ttlMs = defaultTtlMs,
  }: DiskServerCacheOptions = {}) {
    super({ name: 'DiskServerCache' });

    this.cache = new DiskCache(`mastra-server-cache-${this.hash(keyPrefix)}`, { rootDir, ttlMs });
    this.keyPrefix = keyPrefix;
    this.lockStaleMs = lockStaleMs;
    this.lockTimeoutMs = lockTimeoutMs;
  }

  async get(key: string): Promise<unknown> {
    return this.cache.get(this.cacheKey(key));
  }

  async set(key: string, val: unknown, ttlMs?: number): Promise<void> {
    await this.cache.set(this.cacheKey(key), val, ttlMs);
  }

  async listLength(key: string): Promise<number> {
    const val = await this.get(key);
    if (val === undefined) {
      return 0;
    }
    if (!Array.isArray(val)) {
      throw new Error(`${key} exists but is not an array`);
    }

    return val.length;
  }

  async listPush(key: string, val: unknown): Promise<void> {
    await this.withKeyLock(key, async () => {
      const existing = await this.get(key);
      if (existing === undefined) {
        await this.set(key, [val]);
        return;
      }
      if (!Array.isArray(existing)) {
        throw new Error(`${key} exists but is not an array`);
      }

      existing.push(val);
      await this.set(key, existing);
    });
  }

  async listFromTo(key: string, from: number, to = -1): Promise<unknown[]> {
    const val = await this.get(key);
    if (!Array.isArray(val)) {
      return [];
    }

    return val.slice(from, to === -1 ? undefined : to + 1);
  }

  async delete(key: string): Promise<void> {
    await this.cache.del(this.cacheKey(key));
  }

  async clear(): Promise<void> {
    await this.cache.clear();
  }

  async increment(key: string): Promise<number> {
    return this.withKeyLock(key, async () => {
      const existing = await this.get(key);
      if (existing === undefined) {
        await this.set(key, 1);
        return 1;
      }
      if (typeof existing !== 'number') {
        throw new Error(`${key} exists but is not a number`);
      }

      const next = existing + 1;
      await this.set(key, next);
      return next;
    });
  }

  private cacheKey(key: string): string {
    return this.hash(this.keyPrefix + key);
  }

  private hash(val: string): string {
    return createHash('sha256').update(val).digest('hex');
  }

  private async removeFile(filepath: string): Promise<void> {
    try {
      await unlink(filepath);
    } catch (e) {
      if (!hasCode(e, 'ENOENT')) {
        throw e;
      }
    }
  }

  private async withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquireLock(key);
    try {
      return await fn();
    } finally {
      await release();
    }
  }

  private async acquireLock(key: string): Promise<() => Promise<void>> {
    await mkdir(this.cache.dirname, { recursive: true });

    const lockFilepath = path.join(this.cache.dirname, `${this.cacheKey(key)}.lock`);
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      try {
        const handle = await open(lockFilepath, 'wx');
        return async () => {
          await handle.close();
          await this.removeFile(lockFilepath);
        };
      } catch (e) {
        if (!hasCode(e, 'EEXIST')) {
          throw e;
        }

        await this.removeStaleLock(lockFilepath);
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for cache lock for key ${key}`);
        }

        await wait(lockRetryMs);
      }
    }
  }

  private async removeStaleLock(lockFilepath: string): Promise<void> {
    try {
      const lockStats = await stat(lockFilepath);
      if (Date.now() - lockStats.mtimeMs >= this.lockStaleMs) {
        await this.removeFile(lockFilepath);
      }
    } catch (e) {
      if (!hasCode(e, 'ENOENT')) {
        throw e;
      }
    }
  }
}
