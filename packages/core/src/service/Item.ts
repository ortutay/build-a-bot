import { isDeepStrictEqual } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { log } from '../logger.js';
import { itemsTable } from '../storage/db/schema.js';
import { type Storage, type StorageTransaction } from '../storage/Storage.js';

export type ItemOptions = {
  id?: string;
  uniqueId: string;
  createdAt?: string;
  updatedAt?: string;
  lastSeenAt?: string;
  data: unknown;
  sourceUrl: string;
  sourceScriptId: string;
};

export class Item {
  id: string | null;
  uniqueId: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastSeenAt: string | null;
  data: unknown;
  sourceUrl: string;
  sourceScriptId: string;

  constructor(options: ItemOptions) {
    this.id = options.id ?? null;
    this.uniqueId = options.uniqueId;
    this.createdAt = options.createdAt ?? null;
    this.updatedAt = options.updatedAt ?? null;
    this.lastSeenAt = options.lastSeenAt ?? null;
    this.data = options.data;
    this.sourceUrl = options.sourceUrl;
    this.sourceScriptId = options.sourceScriptId;
  }

  // Metadata does not affect whether two items contain the same data.
  compareTo(item: Item): boolean {
    return isDeepStrictEqual(this.data, item.data);
  }

  async save(storage: Storage, db: Storage['db'] | StorageTransaction = storage.db): Promise<void> {
    const now = new Date().toISOString();
    let item;

    if (this.id) {
      log.info(`Updating item id=${this.id}`);
      const [existing] = await db
        .select()
        .from(itemsTable)
        .where(
          this.id
            ? eq(itemsTable.id, this.id)
            : and(
                eq(itemsTable.sourceScriptId, this.sourceScriptId),
                eq(itemsTable.sourceUrl, this.sourceUrl),
                eq(itemsTable.uniqueId, this.uniqueId)
              )
        )
        .limit(1);
      const lastSeenAt = this.lastSeenAt ?? now;
      const updatedAt = existing && this.compareTo(new Item(existing)) ? existing.updatedAt : now;
      const r = await db
        .update(itemsTable)
        .set({
          data: this.data,
          lastSeenAt,
          updatedAt,
          sourceScriptId: this.sourceScriptId,
          sourceUrl: this.sourceUrl,
          uniqueId: this.uniqueId,
        })
        .where(eq(itemsTable.id, this.id))
        .returning();
      item = r[0];
    } else {
      log.info(`Saving item uniqueId=${this.uniqueId}`);
      const r = await db
        .insert(itemsTable)
        .values({
          data: this.data,
          lastSeenAt: now,
          updatedAt: now,
          sourceUrl: this.sourceUrl,
          sourceScriptId: this.sourceScriptId,
          uniqueId: this.uniqueId,
        })
        .onConflictDoUpdate({
          target: [itemsTable.sourceScriptId, itemsTable.sourceUrl, itemsTable.uniqueId],
          set: { data: this.data, lastSeenAt: now, updatedAt: now },
        })
        .returning();
      item = r[0];
    }

    if (!item) {
      throw new Error(`Could not save item: ${this.uniqueId}`);
    }

    this.createdAt = item.createdAt;
    this.id = item.id;
    this.lastSeenAt = item.lastSeenAt;
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
