import fs from 'fs';
import path from 'path';

export const DiskCache = class {
  constructor(dirname, options) {
    this.logger = console;
    this.dirname = dirname;
    fs.promises.mkdir(dirname, { recursive: true });
    this.readOnly = options?.readOnly;
    this.writeOnly = options?.writeOnly;
  }

  _cleanKey(key) {
    return key.replaceAll('/', '-');
  }

  async set(key, val) {
    if (this.readOnly) {
      return;
    }

    key = this._cleanKey(key);

    console.log('Cache set:', key);

    const filepath = path.join(this.dirname, key);

    const ttl = 24 * 3600;
    const data = { val, expiresAt: Date.now() + ttl * 1000 };
    const ser = JSON.stringify(data);

    const tmpFilepath = [filepath, Math.random().toString(), 'writing'].join(
      '.'
    );
    try {
      await fs.promises.writeFile(tmpFilepath, ser, 'utf8');
      await fs.promises.rename(tmpFilepath, filepath);
    } catch {
      fs.promises.unlink(tmpFilepath).catch(() => {
        /* ignore */
      });
    }
  }

  async get(key) {
    if (this.writeOnly) {
      return;
    }

    key = this._cleanKey(key);

    const filepath = path.join(this.dirname, key);
    let file;
    try {
      file = await fs.promises.readFile(filepath, 'utf8');
    } catch (e) {
      if (e.code == 'ENOENT') return null;
      throw e;
    }

    let data;
    try {
      data = JSON.parse(file);
    } catch (e) {
      this.logger.warn(`Failed to parse JSON for cache file ${filepath}: ${e}`);
      this.del(key);
      return null;
    }

    if (Date.now() > data.expiresAt || data.val == undefined) {
      this.del(key);
      return null;
    }

    return data.val;
  }

  async del(key) {
    key = this._cleanKey(key);

    const filepath = path.join(this.dirname, key);
    try {
      await fs.promises.unlink(filepath);
    } catch (e) {
      if (e.code == 'ENOENT') return;
      throw e;
    }
  }
};
