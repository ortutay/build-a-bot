import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { drizzle } from 'drizzle-orm/libsql';
import { describe, expect, it } from 'vitest';
import { storageSchemaVersion } from '../../src/constants.js';

const exec = promisify(execFile);
const loader = import.meta.resolve('tsx');
const storageUrl = new URL('../../src/storage/Storage.ts', import.meta.url).href;
const script = `
  import { Storage } from ${JSON.stringify(storageUrl)};
  const stores = Array.from({ length: 4 }, () => new Storage());
  try {
    await Promise.all(stores.map((store) => store.init()));
    for (const [i, store] of stores.entries()) {
      const id = process.argv[1] + ':' + i;
      await store.db.$client.execute({
        sql: 'INSERT INTO accounts (id, created_at, updated_at, username) VALUES (?, ?, ?, ?)',
        args: [id, 'now', 'now', id],
      });
    }
  } finally {
    for (const store of stores) {
      try { store.db.$client.close(); } catch {}
    }
  }
`;

describe('Storage initialization', () => {
  it.each(['missing', 'old'])(
    'serializes clients with a %s schema marker',
    async (marker) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'builder-storage-init-'));
      const dir = path.join(root, '.build-a-bot');
      const url = `file:${path.join(dir, 'data.db')}`;
      const run = (id: string) =>
        exec(process.execPath, ['--import', loader, '--input-type=module', '-e', script, id], {
          cwd: root,
          timeout: 20_000,
        });

      try {
        await mkdir(dir);
        const legacy = drizzle({ connection: { url } });
        try {
          await legacy.$client.execute('CREATE TABLE legacy (id TEXT)');
        } finally {
          legacy.$client.close();
        }
        if (marker === 'old') {
          await writeFile(path.join(dir, 'storage-schema-version'), 'old');
        }

        const clients = await Promise.allSettled([run('a'), run('b'), run('c')]);
        for (const client of clients) {
          if (client.status === 'rejected') throw client.reason;
        }
        // A later initialization must preserve the first clients' writes.
        await run('later');

        const db = drizzle({ connection: { url } });
        try {
          const accounts = await db.$client.execute('SELECT COUNT(*) AS count FROM accounts');
          expect(accounts.rows[0]!.count).toBe(16);
          const legacy = await db.$client.execute({
            sql: 'SELECT name FROM sqlite_master WHERE name = ?',
            args: ['legacy'],
          });
          expect(legacy.rows).toEqual([]);
        } finally {
          db.$client.close();
        }
        expect((await readFile(path.join(dir, 'storage-schema-version'), 'utf8')).trim()).toBe(
          storageSchemaVersion
        );
        await expect(readFile(path.join(dir, 'storage-init.lock'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000
  );
});
