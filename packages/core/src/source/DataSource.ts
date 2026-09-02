import { eq } from 'drizzle-orm';
import { dataSourcesTable } from '../storage/db/schema.js';
import { type Storage } from '../storage/Storage.js';
import { type Url, parseUrl } from '../types.js';

export type DataSourceOptions = {
  id?: string;
  url: string;
};

export class DataSource {
  id: string | null;
  url: Url;

  constructor({ id, url }: DataSourceOptions) {
    this.id = id ?? null;
    this.url = parseUrl(url);
  }

  static async findByUrl(storage: Storage, url: string): Promise<DataSource | null> {
    const [dataSource] = await storage.db
      .select()
      .from(dataSourcesTable)
      .where(eq(dataSourcesTable.url, url))
      .limit(1);

    return dataSource ? new DataSource(dataSource) : null;
  }

  async save(storage: Storage): Promise<void> {
    const [dataSource] = await storage.db
      .insert(dataSourcesTable)
      .values({ url: this.url })
      .onConflictDoUpdate({
        target: dataSourcesTable.url,
        set: { url: this.url },
      })
      .returning();
    if (!dataSource) {
      throw new Error(`Could not save data source: ${this.url}`);
    }

    this.id = dataSource.id;
  }
}
