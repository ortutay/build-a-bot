import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { expect, it } from 'vitest';
import { initializeDb } from '../../src/storage/Storage.js';
import { dataServicesTable } from '../../src/storage/db/schema.js';

it('moves stored identity metadata into its own column without losing services or schemas', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'builder-identity-migration-'));
  const db = drizzle({ connection: { url: `file:${path.join(root, 'data.db')}` } });
  try {
    const initial = '20260911050000_initial_schema';
    const migrationsFolder = path.join(root, 'migrations');
    await cp(
      new URL(`../../src/db/drizzle/${initial}`, import.meta.url),
      path.join(migrationsFolder, initial),
      { recursive: true }
    );
    await migrate(db, { migrationsFolder });
    await db.$client.execute(
      "INSERT INTO accounts (id, created_at, updated_at, username) VALUES ('account', 'now', 'now', 'test')"
    );
    const identity = { fields: [{ path: 'org_number', normalize: 'digits' }] };
    const itemSchema = { type: 'object', properties: { org_number: { type: 'string' } } };
    for (const [id, schema] of [
      ['configured', { ...itemSchema, 'x-fetchfox-identity': identity }],
      ['plain', itemSchema],
    ] as const) {
      await db.$client.execute({
        sql: 'INSERT INTO data_services (id, created_at, updated_at, account_id, name, item_schema) VALUES (?, ?, ?, ?, ?, ?)',
        args: [id, 'now', 'now', 'account', id, JSON.stringify(schema)],
      });
    }
    await initializeDb(db);
    await initializeDb(db);
    const rows = await db.select().from(dataServicesTable).orderBy(dataServicesTable.id);
    expect(rows).toMatchObject([
      { id: 'configured', identity, itemSchema },
      { id: 'plain', identity: null, itemSchema },
    ]);
  } finally {
    db.$client.close();
    await rm(root, { recursive: true, force: true });
  }
});
