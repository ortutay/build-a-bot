import fs from 'fs';
import path from 'path';
import { log } from '../logger.js';

export type DiskCacheOptions = {
  readOnly?: boolean;
  writeOnly?: boolean;
};

type CacheEntry<Value> = {
  val: Value;
  expiresAt: number;
};

const hasCode = (e: unknown, code: string): boolean =>
  e instanceof Error && 'code' in e && (e as { code?: unknown }).code === code;

const isCacheEntry = <Value>(value: unknown): value is CacheEntry<Value> =>
  typeof value === 'object' &&
  value !== null &&
  'expiresAt' in value &&
  typeof value.expiresAt === 'number' &&
  'val' in value;

export class DiskCache<Value = unknown> {
  readonly logger: Pick<Console, 'warn'>;
  readonly dirname: string;
  readonly readOnly: boolean;
  readonly writeOnly: boolean;

  constructor(dirname: string, options: DiskCacheOptions = {}) {
    this.logger = console;
    this.dirname = dirname;
    fs.promises.mkdir(dirname, { recursive: true });
    this.readOnly = options.readOnly ?? false;
    this.writeOnly = options.writeOnly ?? false;
  }

  _cleanKey(key: string): string {
    return key.replaceAll('/', '-');
  }

  async set(key: string, val: Value): Promise<void> {
    if (this.readOnly) {
      return;
    }

    key = this._cleanKey(key);

    log.debug(`Cache set: ${key}`);

    const filepath = path.join(this.dirname, key);

    const ttl = 24 * 3600;
    const data: CacheEntry<Value> = { val, expiresAt: Date.now() + ttl * 1000 };
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

  async get(key: string): Promise<Value | null | undefined> {
    if (this.writeOnly) {
      return;
    }

    key = this._cleanKey(key);

    const filepath = path.join(this.dirname, key);
    let file: string;
    try {
      file = await fs.promises.readFile(filepath, 'utf8');
    } catch (e) {
      if (hasCode(e, 'ENOENT')) return null;
      throw e;
    }

    let data: unknown;
    try {
      data = JSON.parse(file);
    } catch (e) {
      this.logger.warn(`Failed to parse JSON for cache file ${filepath}: ${e}`);
      this.del(key);
      return null;
    }

    if (!isCacheEntry<Value>(data) || Date.now() > data.expiresAt || data.val === undefined) {
      this.del(key);
      return null;
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
}
