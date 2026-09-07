import { eq } from 'drizzle-orm';
import { createGlobalContext, type GlobalContext } from '../../context/index.js';
import type { ISerializable } from '../../interface/ISerializable.js';
import type { ISaveable } from '../../interface/ISaveable.js';
import type { StorageTransaction } from '../../storage/Storage.js';
import { dataServicesTable, dataSourcesTable, servicesTable } from '../../storage/db/schema.js';
import { findById, findByKey } from '../../storage/helpers.js';
import { type Url, parseUrl } from '../../types.js';
import type { DataService } from './DataService.js';

export type DataSourceConfig = { url: string };

export type DataSourceOptions = DataSourceConfig & {
  context?: GlobalContext;
  dataServiceId?: string;
  dataServiceKey?: string;
  id?: string;
};

const maxUrlLength = 2000;

const normalizeUrl = (url: string): Url => {
  const normalizedUrl = parseUrl(url);
  if (normalizedUrl.length > maxUrlLength) {
    throw new RangeError(`Data source URL exceeds ${maxUrlLength} characters`);
  }

  return normalizedUrl;
};

const keyFor = (dataServiceKey: string, url: Url): string =>
  `${dataServiceKey}/${encodeURIComponent(url)}`;

export class DataSource implements ISerializable<DataSourceConfig>, ISaveable {
  dataServiceId: string | null;
  dataServiceKey: string | null;
  id: string | null;
  url: Url;
  #context?: GlobalContext;

  constructor(options: DataSourceOptions) {
    this.#context = options.context;
    this.dataServiceId = options.dataServiceId ?? null;
    this.dataServiceKey = options.dataServiceKey ?? null;
    this.id = options.id ?? null;
    this.url = normalizeUrl(options.url);
  }

  get key(): string {
    const dataServiceKey = this.dataServiceKey;
    if (!dataServiceKey) {
      throw new Error(`Cannot create a data source key without a data service: ${this.url}`);
    }

    return keyFor(dataServiceKey, this.url);
  }

  bindContext(context: GlobalContext): void {
    if (this.#context && this.#context !== context) {
      throw new Error('Data source already has a different bound context');
    }

    this.#context = context;
  }

  bindDataService(dataService: DataService): void {
    const dataServiceKey = dataService.key;
    if (this.dataServiceKey && this.dataServiceKey !== dataServiceKey) {
      throw new Error('Data source already has a different data service');
    }

    this.dataServiceId = dataService.id;
    this.dataServiceKey = dataServiceKey;
  }

  detachDataService(): void {
    this.dataServiceId = null;
    this.dataServiceKey = null;
  }

  async context(): Promise<GlobalContext> {
    this.#context ??= await createGlobalContext();
    return this.#context;
  }

  static async findById(context: GlobalContext, id: string): Promise<DataSource | null> {
    const dataSource = await findById(dataSourcesTable, context, id);

    return dataSource ? DataSource.#fromRow(context, dataSource) : null;
  }

  static async findByKey(context: GlobalContext, key: string): Promise<DataSource | null> {
    const dataSource = await findByKey(dataSourcesTable, context, key);

    return dataSource ? DataSource.#fromRow(context, dataSource) : null;
  }

  static async findByUrl(
    context: GlobalContext,
    dataService: DataService,
    url: string
  ): Promise<DataSource | null> {
    return DataSource.findByKey(context, keyFor(dataService.key, normalizeUrl(url)));
  }

  async save(tx?: StorageTransaction): Promise<void> {
    const context = await this.context();
    await context.init();
    const dataServiceId = this.dataServiceId;
    if (!dataServiceId) {
      throw new Error(`Cannot save a data source without a data service: ${this.url}`);
    }
    const key = this.key;
    const dataServiceKey = this.dataServiceKey!;

    await context.storage.fillInTransaction(tx, async (tx) => {
      const [dataService] = await tx
        .select({ key: servicesTable.key })
        .from(dataServicesTable)
        .innerJoin(servicesTable, eq(dataServicesTable.serviceId, servicesTable.id))
        .where(eq(dataServicesTable.serviceId, dataServiceId))
        .limit(1);
      if (!dataService || dataService.key !== dataServiceKey) {
        throw new Error(`Cannot save data source without a saved data service: ${this.url}`);
      }

      const [dataSource] = await tx
        .insert(dataSourcesTable)
        .values({
          dataServiceId,
          key,
          url: this.url,
        })
        .onConflictDoUpdate({
          target: dataSourcesTable.key,
          set: { dataServiceId, url: this.url },
        })
        .returning();
      if (!dataSource) {
        throw new Error(`Could not save data source: ${this.url}`);
      }

      this.id = dataSource.id;
    });
  }

  async remove(tx?: StorageTransaction): Promise<void> {
    if (!this.id) {
      throw new Error('Cannot remove an unsaved data source');
    }

    const context = await this.context();
    await context.init();
    await context.storage.fillInTransaction(tx, async (tx) => {
      await tx.delete(dataSourcesTable).where(eq(dataSourcesTable.id, this.id!));
      this.id = null;
    });
  }

  dump(): DataSourceConfig {
    return { url: this.url };
  }

  static load(config: DataSourceConfig, context?: GlobalContext): DataSource {
    return new DataSource({ context, ...config });
  }

  static async #fromRow(
    context: GlobalContext,
    dataSource: typeof dataSourcesTable.$inferSelect
  ): Promise<DataSource> {
    const [dataService] = await context.storage.db
      .select({ key: servicesTable.key })
      .from(dataServicesTable)
      .innerJoin(servicesTable, eq(dataServicesTable.serviceId, servicesTable.id))
      .where(eq(dataServicesTable.serviceId, dataSource.dataServiceId))
      .limit(1);
    if (!dataService) {
      throw new Error(`Could not load data service for data source: ${dataSource.id}`);
    }

    return new DataSource({ context, dataServiceKey: dataService.key, ...dataSource });
  }
}
