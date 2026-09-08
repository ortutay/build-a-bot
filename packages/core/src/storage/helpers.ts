import { eq, type InferSelectModel } from 'drizzle-orm';
import type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core';
import type { GlobalContext } from '../context/index.js';
import type { StorageTransaction } from './Storage.js';

type TableWithId = AnySQLiteTable & { id: AnySQLiteColumn };

export const findById = async <TTable extends TableWithId>(
  table: TTable,
  context: GlobalContext,
  id: string,
  tx?: StorageTransaction
): Promise<InferSelectModel<TTable> | null> => {
  await context.init();
  const db = tx ?? context.storage.db;
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);

  return (row as InferSelectModel<TTable> | undefined) ?? null;
};
