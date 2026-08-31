import { sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { srid } from '../../internal/util/index.js';

export const servicesTable = sqliteTable('services', {
  id: text()
    .primaryKey()
    .$defaultFn(() => srid()),
  name: text().notNull().unique(),
});

export const scriptsTable = sqliteTable(
  'scripts',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => srid()),
    serviceId: text('service_id')
      .notNull()
      .references(() => servicesTable.id),
    name: text().notNull(),
    code: text().notNull(),
    exports: text({ mode: 'json' }).$type<string[]>().notNull(),
    context: text({ mode: 'json' }).$type<string[]>().notNull(),
    modules: text({ mode: 'json' }).$type<string[]>().notNull(),
    tools: text({ mode: 'json' }).$type<string[]>().notNull(),
  },
  (table) => [unique('scripts_service_id_name_unique').on(table.serviceId, table.name)]
);
