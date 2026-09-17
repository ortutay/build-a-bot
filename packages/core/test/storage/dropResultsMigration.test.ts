import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/libsql';
import { expect, it } from 'vitest';
import { createTemporaryDb } from '../lib/temporaryDb.js';

it('drops historical results without removing runs or items', async () => {
  const db = drizzle({ connection: { url: ':memory:' } });
  try {
    await db.$client.execute('CREATE TABLE runs (id TEXT PRIMARY KEY)');
    await db.$client.execute('CREATE TABLE items (id TEXT PRIMARY KEY)');
    await db.$client.execute(
      'CREATE TABLE results (id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id))'
    );
    await db.$client.execute("INSERT INTO runs VALUES ('run')");
    await db.$client.execute("INSERT INTO items VALUES ('item')");
    await db.$client.execute("INSERT INTO results VALUES ('result', 'run')");
    const sql = await readFile(
      new URL('../../src/db/drizzle/20260915002000_drop_results/migration.sql', import.meta.url),
      'utf8'
    );
    await db.$client.execute(sql);
    expect(
      (await db.$client.execute("SELECT name FROM sqlite_master WHERE name = 'results'")).rows
    ).toEqual([]);
    expect((await db.$client.execute('SELECT * FROM runs')).rows).toEqual([{ id: 'run' }]);
    expect((await db.$client.execute('SELECT * FROM items')).rows).toEqual([{ id: 'item' }]);
  } finally {
    db.$client.close();
  }
});

it('does not leave a results table in a newly migrated database', async () => {
  const db = await createTemporaryDb();
  try {
    expect(
      (await db.storage.db.$client.execute("SELECT name FROM sqlite_master WHERE name = 'results'"))
        .rows
    ).toEqual([]);
  } finally {
    await db.dispose();
  }
});
