import { afterEach, expect, it, vi } from 'vitest';
import { Item } from '../../src/service/Item.js';
import {
  accountsTable,
  dataServicesTable,
  itemsTable,
  scriptsTable,
} from '../../src/storage/db/schema.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

let db: TemporaryDb | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await db?.dispose();
  db = undefined;
});

const options = {
  uniqueId: 'item',
  sourceUrl: 'https://example.test',
  sourceScriptId: 'script',
  data: { name: 'Example', details: { tags: ['one', 'two'] } },
};

it('compares only data, including nested fields, regardless of metadata or key order', () => {
  const first = new Item(options);
  const second = new Item({
    ...options,
    id: 'other',
    uniqueId: 'other',
    sourceUrl: 'https://other.test',
    sourceScriptId: 'other',
    createdAt: 'earlier',
    updatedAt: 'later',
    lastSeenAt: 'now',
    data: { details: { tags: ['one', 'two'] }, name: 'Example' },
  });
  expect(first.compareTo(second)).toBe(true);
  second.data = { ...options.data, details: { tags: ['changed'] } };
  expect(first.compareTo(second)).toBe(false);
});

it('sets updatedAt only when stored data changes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const firstTime = '2026-09-15T01:00:00.000Z';
  const secondTime = '2026-09-15T02:00:00.000Z';
  const thirdTime = '2026-09-15T03:00:00.000Z';
  vi.setSystemTime(new Date(firstTime));
  db = await createTemporaryDb();
  const storage = db.storage;
  await storage.db.insert(accountsTable).values({ id: 'account', username: 'test' });
  await storage.db.insert(dataServicesTable).values({
    id: 'service',
    accountId: 'account',
    name: 'test',
    itemSchema: {},
  });
  await storage.db.insert(scriptsTable).values({
    id: 'script',
    dataServiceId: 'service',
    name: 'test',
    code: '',
    exports: [],
    vmContext: [],
    modules: [],
    tools: [],
  });
  const first = new Item(options);
  await first.save(storage);
  expect(first.updatedAt).toBe(firstTime);

  vi.setSystemTime(new Date(secondTime));
  const repeated = new Item({
    ...options,
    id: first.id!,
    updatedAt: 'caller timestamp is ignored',
    lastSeenAt: secondTime,
    data: { details: { tags: ['one', 'two'] }, name: 'Example' },
  });
  await repeated.save(storage);
  expect(repeated.id).toBe(first.id);
  expect(repeated.createdAt).toBe(firstTime);
  expect(repeated.updatedAt).toBe(firstTime);
  expect(repeated.lastSeenAt).toBe(secondTime);

  vi.setSystemTime(new Date(thirdTime));
  const changed = new Item({
    ...options,
    id: first.id!,
    data: { ...options.data, name: 'Changed' },
    lastSeenAt: thirdTime,
  });
  await changed.save(storage);
  expect(changed.updatedAt).toBe(thirdTime);
  expect(changed.createdAt).toBe(firstTime);
  expect(await storage.db.select().from(itemsTable)).toMatchObject([
    {
      id: first.id,
      updatedAt: thirdTime,
      lastSeenAt: thirdTime,
      data: { name: 'Changed' },
    },
  ]);
});
