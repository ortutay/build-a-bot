type CacheEntry<Value> = {
  val: Value;
  expiresAt: number;
};

export type MemoryCacheOptions = {
  readOnly?: boolean;
  writeOnly?: boolean;
};

export class MemoryCache<Value = unknown> {
  readonly readOnly: boolean;
  readonly writeOnly: boolean;
  readonly entries: Map<string, string>;

  constructor(options: MemoryCacheOptions = {}) {
    this.readOnly = options.readOnly ?? false;
    this.writeOnly = options.writeOnly ?? false;
    this.entries = new Map();
  }

  _cleanKey(key: string): string {
    return key.replaceAll('/', '-');
  }

  async set(key: string, val: Value): Promise<void> {
    if (this.readOnly) {
      return;
    }

    key = this._cleanKey(key);

    const ttl = 24 * 3600;
    const data: CacheEntry<Value> = { val, expiresAt: Date.now() + ttl * 1000 };
    const ser = JSON.stringify(data);
    if (ser === undefined) {
      throw new TypeError('Cache value is not JSON serializable');
    }

    this.entries.set(key, ser);
  }

  async get(key: string): Promise<Value | null | undefined> {
    if (this.writeOnly) {
      return;
    }

    key = this._cleanKey(key);

    const ser = this.entries.get(key);
    if (ser === undefined) {
      return null;
    }

    const data = JSON.parse(ser) as CacheEntry<Value>;
    if (Date.now() > data.expiresAt || data.val === undefined) {
      await this.del(key);
      return null;
    }

    return data.val;
  }

  async del(key: string): Promise<void> {
    key = this._cleanKey(key);
    this.entries.delete(key);
  }
}
