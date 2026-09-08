import fs from 'fs';
import os from 'os';
import path from 'path';
import { log } from '../logger.js';

export type DiskCacheOptions = {
  rootDir?: string;
  readOnly?: boolean;
  ttlMs?: number;
  writeOnly?: boolean;
};

type CacheEntry<Value> = {
  val: Value;
  expiresAt: number | null;
};

const hasCode = (e: unknown, code: string): boolean =>
  e instanceof Error && 'code' in e && (e as { code?: unknown }).code === code;

const isCacheEntry = <Value>(value: unknown): value is CacheEntry<Value> =>
  typeof value === 'object' &&
  value !== null &&
  'expiresAt' in value &&
  (typeof value.expiresAt === 'number' || value.expiresAt === null) &&
  'val' in value;

export class DiskCache<Value = unknown> {
  readonly logger: Pick<Console, 'warn'>;
  readonly dirname: string;
  readonly readOnly: boolean;
  readonly ttlMs: number;
  readonly writeOnly: boolean;

  constructor(
    namespace: string,
    {
      rootDir = path.join(os.tmpdir(), 'build-a-bot', 'cache'),
      readOnly = false,
      ttlMs = 24 * 3600 * 1000,
      writeOnly = false,
    }: DiskCacheOptions = {}
  ) {
    this.logger = console;
    this.dirname = path.join(rootDir, namespace);
    this.readOnly = readOnly;
    this.ttlMs = ttlMs;
    this.writeOnly = writeOnly;
  }

  _cleanKey(key: string): string {
    return key.replaceAll('/', '-');
  }

  async set(key: string, val: Value, ttlMs: number = this.ttlMs): Promise<void> {
    if (this.readOnly) {
      return;
    }

    key = this._cleanKey(key);

    log.debug(`Cache set: ${key}`);

    await fs.promises.mkdir(this.dirname, { recursive: true });

    const filepath = path.join(this.dirname, key);

    const data: CacheEntry<Value> = {
      val,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null,
    };
    const ser = JSON.stringify(data);
    if (ser === undefined) {
      throw new TypeError('Cache value is not JSON serializable');
    }

    const tmpFilepath = [filepath, Math.random().toString(), 'writing'].join('.');
    try {
      await fs.promises.writeFile(tmpFilepath, ser, 'utf8');
      await fs.promises.rename(tmpFilepath, filepath);
    } catch {
      fs.promises.unlink(tmpFilepath).catch(() => {
        /* ignore */
      });
    }
  }

  async get(key: string): Promise<Value | undefined> {
    if (this.writeOnly) {
      return;
    }

    key = this._cleanKey(key);

    const filepath = path.join(this.dirname, key);
    let file: string;
    try {
      file = await fs.promises.readFile(filepath, 'utf8');
    } catch (e) {
      if (hasCode(e, 'ENOENT')) return undefined;
      throw e;
    }

    let data: unknown;
    try {
      data = JSON.parse(file);
    } catch (e) {
      this.logger.warn(`Failed to parse JSON for cache file ${filepath}: ${e}`);
      await this.del(key);
      return undefined;
    }

    if (
      !isCacheEntry<Value>(data) ||
      (data.expiresAt !== null && Date.now() >= data.expiresAt) ||
      data.val === undefined
    ) {
      await this.del(key);
      return undefined;
    }

    return data.val;
  }

  async del(key: string): Promise<void> {
    key = this._cleanKey(key);

    const filepath = path.join(this.dirname, key);
    try {
      await fs.promises.unlink(filepath);
    } catch (e) {
      if (hasCode(e, 'ENOENT')) return;
      throw e;
    }
  }

  async clear(): Promise<void> {
    await fs.promises.rm(this.dirname, { force: true, recursive: true });
    await fs.promises.mkdir(this.dirname, { recursive: true });
  }
}
