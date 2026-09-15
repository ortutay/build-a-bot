import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Account } from '../../src/account/Account.js';
import type { GlobalContext } from '../../src/context/index.js';
import { DataService } from '../../src/service/DataService.js';
import { DataSource } from '../../src/service/DataSource.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

const countRows = async (temporaryDb: TemporaryDb, table: string): Promise<number> => {
  const result = await temporaryDb.storage.db.$client.execute(
    `SELECT COUNT(*) AS count FROM ${table}`
  );
  const [row] = result.rows;
  return Number(row?.count ?? 0);
};

describe('DataService persistence', () => {
  let temporaryDb: TemporaryDb | null = null;

  afterEach(async () => {
    await temporaryDb?.dispose();
    temporaryDb = null;
  });

  it('reconciles removed sources transactionally without affecting other services', async () => {
    temporaryDb = await createTemporaryDb();
    const context = {
      init: () => temporaryDb!.storage.init(),
      storage: temporaryDb.storage,
    } as GlobalContext;
    const a = 'https://example.test/a';
    const b = 'https://example.test/b';
    const service = new DataService({
      context,
      name: 'reconcile',
      itemSchema: z.object({}),
      sources: [a, b].map((url) => new DataSource({ url })),
    });
    const sibling = new DataService({
      context,
      name: 'sibling',
      itemSchema: z.object({}),
      sources: [new DataSource({ url: a })],
    });
    await service.save();
    await sibling.save();
    const sources = async (id: string) =>
      (await DataService.findById(context, id))!.sources.map((source) => source.url).sort();
    service.sources = [service.sources[1]!];
    await expect(
      context.storage.fillInTransaction(undefined, async (tx) => {
        await service.save(tx);
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(await sources(service.id!)).toEqual([a, b]);
    await service.save();
    expect(await sources(service.id!)).toEqual([b]);
    service.sources = [];
    await service.save();
    expect(await sources(service.id!)).toEqual([]);
    expect(await sources(sibling.id!)).toEqual([a]);
  });

  it('accepts a JSON Schema item schema', () => {
    const itemSchema = {
      properties: { name: { type: 'string' } },
      required: ['name'],
      type: 'object',
    };
    const dataService = new DataService({
      itemSchema,
      name: 'real-estate-data-service',
      sources: [],
    });

    expect(dataService.dump().itemSchema).toEqual(itemSchema);
    expect(dataService.itemSchema.safeParse({ name: 'Ada' }).success).toBe(true);
    expect(dataService.itemSchema.safeParse({}).success).toBe(false);
  });

  it('requires saved parent configuration objects', async () => {
    temporaryDb = await createTemporaryDb();
    const context = {
      init: () => temporaryDb!.storage.init(),
      storage: temporaryDb.storage,
    } as GlobalContext;
    const account = new Account({ context, username: 'owner' });
    const dataService = new DataService({
      account,
      context,
      itemSchema: z.object({ name: z.string() }),
      name: 'real-estate-data-service',
      sources: [],
    });
    const dataSource = new DataSource({ context, url: 'https://example.test/agents' });

    await expect(dataService.save()).rejects.toThrow(
      'Cannot save data service without a saved account'
    );
    await expect(dataSource.save()).rejects.toThrow(
      'Cannot save a data source without a data service'
    );

    await account.save();
    await expect(dataService.save()).resolves.toBeUndefined();
  });

  it('saves, loads, finds, removes, and restores its configuration', async () => {
    temporaryDb = await createTemporaryDb();
    const context = {
      init: () => temporaryDb!.storage.init(),
      storage: temporaryDb.storage,
    } as GlobalContext;
    const sourceUrl = 'https://example.test/agents';
    const dataSource = new DataSource({
      context,
      url: sourceUrl,
    });
    const dataService = new DataService({
      context,
      name: 'real-estate-data-service',
      sources: [dataSource],
      itemSchema: z.object({
        email: z.string(),
        name: z.string(),
      }),
    });

    await dataService.save();

    expect(dataService.id).toEqual(expect.any(String));
    expect(dataSource.id).toEqual(expect.any(String));
    expect(await countRows(temporaryDb, 'accounts')).toBe(1);
    expect(await countRows(temporaryDb, 'data_services')).toBe(1);
    expect(await countRows(temporaryDb, 'data_sources')).toBe(1);
    await expect(
      temporaryDb.storage.db.$client.execute('SELECT username FROM accounts')
    ).resolves.toMatchObject({ rows: [{ username: 'local' }] });
    await expect(
      temporaryDb.storage.db.$client.execute('SELECT name FROM data_services')
    ).resolves.toMatchObject({ rows: [{ name: 'real-estate-data-service' }] });
    await expect(
      temporaryDb.storage.db.$client.execute('SELECT url FROM data_sources')
    ).resolves.toMatchObject({ rows: [{ url: sourceUrl }] });

    const config = dataService.dump();

    const id = dataService.id!;
    const foundById = await DataService.findById(context, id);
    expect(foundById?.dump()).toEqual(config);

    const foundByName = await DataService.findByName(
      context,
      dataService.account!.id!,
      dataService.name
    );
    expect(foundByName?.dump()).toEqual(config);

    const foundSourceById = await DataSource.findById(context, dataSource.id!);
    expect(foundSourceById?.dump()).toEqual(dataSource.dump());
    const foundSourceByUrl = await DataSource.findByUrl(context, dataService.id!, sourceUrl);
    expect(foundSourceByUrl?.dump()).toEqual(dataSource.dump());

    await dataService.remove();

    expect(await countRows(temporaryDb, 'accounts')).toBe(1);
    expect(await countRows(temporaryDb, 'data_services')).toBe(0);
    expect(await countRows(temporaryDb, 'data_sources')).toBe(0);
  });

  it('updates the existing service when another instance has the same name', async () => {
    temporaryDb = await createTemporaryDb();
    const context = {
      init: () => temporaryDb!.storage.init(),
      storage: temporaryDb.storage,
    } as GlobalContext;
    const first = new DataService({
      context,
      name: 'real-estate-data-service',
      sources: [new DataSource({ context, url: 'https://example.test/agents' })],
      itemSchema: z.object({
        name: z.string(),
      }),
    });

    await first.save();

    const firstResult = await temporaryDb.storage.db.$client.execute(
      'SELECT item_schema, updated_at FROM data_services'
    );
    const [firstRow] = firstResult.rows;
    const firstItemSchema = JSON.parse(String(firstRow?.item_schema));
    const firstUpdatedAt = String(firstRow?.updated_at);
    expect(firstResult.rows).toHaveLength(1);
    expect(firstItemSchema).toEqual(z.toJSONSchema(first.itemSchema));
    expect(firstItemSchema.properties).toHaveProperty('name');
    expect(firstItemSchema.properties).not.toHaveProperty('email');

    await new Promise((resolve) => setTimeout(resolve, 1));

    const second = new DataService({
      context,
      name: first.name,
      sources: [new DataSource({ context, url: 'https://example.test/agents' })],
      itemSchema: z.object({
        email: z.string().email(),
        name: z.string(),
      }),
    });

    await second.save();

    expect(second.id).toBe(first.id);
    expect(await countRows(temporaryDb, 'accounts')).toBe(1);
    expect(await countRows(temporaryDb, 'data_services')).toBe(1);
    expect(await countRows(temporaryDb, 'data_sources')).toBe(1);
    const result = await temporaryDb.storage.db.$client.execute(
      'SELECT item_schema, updated_at FROM data_services'
    );
    const [row] = result.rows;
    const itemSchema = JSON.parse(String(row?.item_schema));
    expect(result.rows).toHaveLength(1);
    expect(itemSchema).toEqual(z.toJSONSchema(second.itemSchema));
    expect(itemSchema.properties).toHaveProperty('name');
    expect(itemSchema.properties).toHaveProperty('email');
    expect(String(row?.updated_at)).not.toBe(firstUpdatedAt);
  });
});
