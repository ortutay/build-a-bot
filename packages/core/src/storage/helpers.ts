import { eq, type InferSelectModel } from 'drizzle-orm';
import type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core';
import type { GlobalContext } from '../context/index.js';

type TableWithId = AnySQLiteTable & { id: AnySQLiteColumn };
type TableWithKey = AnySQLiteTable & { key: AnySQLiteColumn };

export const findById = async <TTable extends TableWithId>(
  table: TTable,
  context: GlobalContext,
  id: string
): Promise<InferSelectModel<TTable> | null> => {
  await context.init();
  const [row] = await context.storage.db.select().from(table).where(eq(table.id, id)).limit(1);

  return (row as InferSelectModel<TTable> | undefined) ?? null;
};

export const findByKey = async <TTable extends TableWithKey>(
  table: TTable,
  context: GlobalContext,
  key: string
): Promise<InferSelectModel<TTable> | null> => {
  await context.init();
  const [row] = await context.storage.db.select().from(table).where(eq(table.key, key)).limit(1);

  return (row as InferSelectModel<TTable> | undefined) ?? null;
};
