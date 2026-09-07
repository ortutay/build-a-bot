import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Account } from '../../src/account/Account.js';
import type { GlobalContext } from '../../src/context/index.js';
import { Service } from '../../src/service/Service.js';
import { DataService } from '../../src/service/data/DataService.js';
import { DataSource } from '../../src/service/data/DataSource.js';
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

  it('normalizes data source URLs and rejects URLs longer than 2,000 characters', () => {
    expect(new DataSource({ url: 'HTTPS://EXAMPLE.TEST:443/agents' }).url).toBe(
      'https://example.test/agents'
    );
    expect(() => new DataSource({ url: `https://example.test/${'a'.repeat(2_000)}` })).toThrow(
      'Data source URL exceeds 2000 characters'
    );
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
    dataSource.dataServiceId = 'missing-data-service';
    await expect(dataSource.save()).rejects.toThrow(
      'Cannot create a data source key without a data service'
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
    const serviceKey = 'local/real-estate-data-service';
    const dataSourceKey = `${serviceKey}/${encodeURIComponent(sourceUrl)}`;
    const dataSource = new DataSource({
      context,
      url: sourceUrl,
    });
    const dataService = new DataService({
      context,
      name: 'real-estate-data-service',
      sources: [dataSource],
      itemSchema: z.object({
        email: z.string().email(),
        name: z.string(),
      }),
    });

    await dataService.save();

    expect(dataService.id).toEqual(expect.any(String));
    expect(dataSource.id).toEqual(expect.any(String));
    expect(await countRows(temporaryDb, 'accounts')).toBe(1);
    expect(await countRows(temporaryDb, 'services')).toBe(1);
    expect(await countRows(temporaryDb, 'data_services')).toBe(1);
    expect(await countRows(temporaryDb, 'data_sources')).toBe(1);
    await expect(
      temporaryDb.storage.db.$client.execute('SELECT key, username FROM accounts')
    ).resolves.toMatchObject({ rows: [{ key: 'local', username: 'local' }] });
    await expect(
      temporaryDb.storage.db.$client.execute('SELECT key, name, type FROM services')
    ).resolves.toMatchObject({
      rows: [{ key: serviceKey, name: 'real-estate-data-service', type: 'data' }],
    });
    await expect(
      temporaryDb.storage.db.$client.execute('SELECT key, url FROM data_sources')
    ).resolves.toMatchObject({ rows: [{ key: dataSourceKey, url: sourceUrl }] });

    const config = dataService.dump();
    expect(config).not.toHaveProperty('key');
    const loaded = DataService.load(config, context);
    expect(loaded.dump()).toEqual(config);

    const id = dataService.id!;
    const foundById = await DataService.findById(context, id);
    expect(foundById?.dump()).toEqual(config);

    const foundByKey = await DataService.findByKey(context, serviceKey);
    expect(foundByKey?.dump()).toEqual(config);

    const foundBaseService = await Service.findById(context, id);
    expect(foundBaseService?.dump()).toEqual(config);
    expect((await Service.findByKey(context, serviceKey))?.dump()).toEqual(config);

    const foundSourceByKey = await DataSource.findByKey(context, dataSourceKey);
    expect(foundSourceByKey?.dump()).toEqual(dataSource.dump());

    await dataService.remove();

    expect(await countRows(temporaryDb, 'accounts')).toBe(1);
    expect(await countRows(temporaryDb, 'services')).toBe(0);
    expect(await countRows(temporaryDb, 'data_services')).toBe(0);
    expect(await countRows(temporaryDb, 'data_sources')).toBe(0);

    await loaded.save();

    expect(loaded.id).toEqual(expect.any(String));
    const restored = await DataService.findById(context, loaded.id!);
    expect(restored?.dump()).toEqual(config);
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
    expect(await countRows(temporaryDb, 'services')).toBe(1);
    expect(await countRows(temporaryDb, 'data_services')).toBe(1);
    expect(await countRows(temporaryDb, 'data_sources')).toBe(1);
    await expect(
      temporaryDb.storage.db.$client.execute('SELECT key FROM services')
    ).resolves.toMatchObject({ rows: [{ key: 'local/real-estate-data-service' }] });
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
