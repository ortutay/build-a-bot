import { and, eq } from 'drizzle-orm';
import { createGlobalContext, type GlobalContext } from '../../context/index.js';
import type { ISerializable } from '../../interface/ISerializable.js';
import type { ISaveable } from '../../interface/ISaveable.js';
import type { StorageTransaction } from '../../storage/Storage.js';
import { dataSourcesTable } from '../../storage/db/schema.js';
import { findById } from '../../storage/helpers.js';
import { type Url, parseUrl } from '../../types.js';

export type DataSourceConfig = { url: string };

export type DataSourceOptions = DataSourceConfig & {
  context?: GlobalContext;
  dataServiceId?: string;
  id?: string;
};

export class DataSource implements ISerializable<DataSourceConfig>, ISaveable {
  dataServiceId: string | null;
  id: string | null;
  url: Url;
  #context?: GlobalContext;

  constructor(options: DataSourceOptions) {
    this.#context = options.context;
    this.dataServiceId = options.dataServiceId ?? null;
    this.id = options.id ?? null;
    this.url = parseUrl(options.url);
  }

  bindContext(context: GlobalContext): void {
    if (this.#context && this.#context !== context) {
      throw new Error('Data source already has a different bound context');
    }

    this.#context = context;
  }

  async context(): Promise<GlobalContext> {
    this.#context ??= await createGlobalContext();
    return this.#context;
  }

  static async findById(context: GlobalContext, id: string): Promise<DataSource | null> {
    const dataSource = await findById(dataSourcesTable, context, id);

    return dataSource ? new DataSource({ context, ...dataSource }) : null;
  }

  static async findByUrl(
    context: GlobalContext,
    dataServiceId: string,
    url: string
  ): Promise<DataSource | null> {
    await context.init();
    const [dataSource] = await context.storage.db
      .select()
      .from(dataSourcesTable)
      .where(
        and(
          eq(dataSourcesTable.dataServiceId, dataServiceId),
          eq(dataSourcesTable.url, parseUrl(url))
        )
      )
      .limit(1);

    return dataSource ? new DataSource({ context, ...dataSource }) : null;
  }

  async save(tx?: StorageTransaction): Promise<void> {
    const context = await this.context();
    await context.init();
    const dataServiceId = this.dataServiceId;
    if (!dataServiceId) {
      throw new Error(`Cannot save a data source without a data service: ${this.url}`);
    }

    await context.storage.fillInTransaction(tx, async (tx) => {
      const [dataSource] = await tx
        .insert(dataSourcesTable)
        .values({
          dataServiceId,
          url: this.url,
        })
        .onConflictDoUpdate({
          target: [dataSourcesTable.dataServiceId, dataSourcesTable.url],
          set: { url: this.url },
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
}
