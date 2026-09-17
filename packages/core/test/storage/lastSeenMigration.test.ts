import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/libsql';
import { expect, it } from 'vitest';

it('backfills lastSeenAt from the last stored update without changing existing data', async () => {
  const db = drizzle({ connection: { url: ':memory:' } });
  try {
    await db.$client.execute(
      'CREATE TABLE items (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL)'
    );
    await db.$client.execute({
      sql: 'INSERT INTO items (id, updated_at, data) VALUES (?, ?, ?)',
      args: ['existing', '2026-09-14T01:00:00.000Z', '{"key":"retained"}'],
    });
    const migration = await readFile(
      new URL('../../src/db/drizzle/20260915000500_item_last_seen/migration.sql', import.meta.url),
      'utf8'
    );
    for (const sql of migration.split('--> statement-breakpoint')) {
      await db.$client.execute(sql);
    }
    const result = await db.$client.execute('SELECT * FROM items');
    expect(result.rows).toEqual([
      {
        id: 'existing',
        updated_at: '2026-09-14T01:00:00.000Z',
        last_seen_at: '2026-09-14T01:00:00.000Z',
        data: '{"key":"retained"}',
      },
    ]);
  } finally {
    db.$client.close();
  }
});
