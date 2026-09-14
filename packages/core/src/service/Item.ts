import { eq } from 'drizzle-orm';
import { itemsTable } from '../storage/db/schema.js';
import { type Storage, type StorageTransaction } from '../storage/Storage.js';

export type ItemOptions = {
  id?: string;
  uniqueId: string;
  createdAt?: string;
  updatedAt?: string;
  data: unknown;
  sourceUrl: string;
  sourceScriptId: string;
};

export class Item {
  id: string | null;
  uniqueId: string;
  createdAt: string | null;
  updatedAt: string | null;
  data: unknown;
  sourceUrl: string;
  sourceScriptId: string;

  constructor(options: ItemOptions) {
    this.id = options.id ?? null;
    this.uniqueId = options.uniqueId;
    this.createdAt = options.createdAt ?? null;
    this.updatedAt = options.updatedAt ?? null;
    this.data = options.data;
    this.sourceUrl = options.sourceUrl;
    this.sourceScriptId = options.sourceScriptId;
  }

  async save(storage: Storage, db: Storage['db'] | StorageTransaction = storage.db): Promise<void> {
    const [item] = await db
      .insert(itemsTable)
      .values({
        data: this.data,
        sourceUrl: this.sourceUrl,
        sourceScriptId: this.sourceScriptId,
        uniqueId: this.uniqueId,
      })
      .onConflictDoUpdate({
        target: [itemsTable.sourceScriptId, itemsTable.sourceUrl, itemsTable.uniqueId],
        set: { data: this.data },
      })
      .returning();
    if (!item) {
      throw new Error(`Could not save item: ${this.uniqueId}`);
    }

    this.createdAt = item.createdAt;
    this.id = item.id;
    this.updatedAt = item.updatedAt;
  }

  async remove(storage: Storage): Promise<void> {
    if (!this.id) {
      throw new Error('Cannot remove an unsaved item');
    }

    const [item] = await storage.db
      .delete(itemsTable)
      .where(eq(itemsTable.id, this.id))
      .returning();
    if (!item) {
      throw new Error(`Could not remove item: ${this.id}`);
    }

    this.id = null;
  }
}
