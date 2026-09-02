import { sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { srid } from '../../internal/util/index.js';

export const runStatuses = ['active', 'done', 'error'] as const;
export type RunStatus = (typeof runStatuses)[number];

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
    buildInput: text('build_input', { mode: 'json' }).$type<Record<string, unknown>>(),
    exports: text({ mode: 'json' }).$type<string[]>().notNull(),
    context: text({ mode: 'json' }).$type<string[]>().notNull(),
    modules: text({ mode: 'json' }).$type<string[]>().notNull(),
    tools: text({ mode: 'json' }).$type<string[]>().notNull(),
  },
  (table) => [unique('scripts_service_id_name_unique').on(table.serviceId, table.name)]
);

export const dataSourcesTable = sqliteTable('data_sources', {
  id: text()
    .primaryKey()
    .$defaultFn(() => srid()),
  url: text().notNull().unique(),
});

export const runsTable = sqliteTable('runs', {
  id: text()
    .primaryKey()
    .$defaultFn(() => srid()),
  scriptId: text('script_id')
    .notNull()
    .references(() => scriptsTable.id),
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  input: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  status: text({ enum: runStatuses }).$type<RunStatus>().notNull(),
  error: text({ mode: 'json' }).$type<Record<string, unknown>>(),
});

export const resultsTable = sqliteTable('results', {
  id: text()
    .primaryKey()
    .$defaultFn(() => srid(10)),
  runId: text('run_id')
    .notNull()
    .references(() => runsTable.id),
  createdAt: text('created_at').notNull(),
  data: text({ mode: 'json' }).$type<unknown>().notNull(),
});

export const itemsTable = sqliteTable(
  'items',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => srid()),
    sourceScriptId: text('source_script_id')
      .notNull()
      .references(() => scriptsTable.id),
    dataSourceId: text('data_source_id')
      .notNull()
      .references(() => dataSourcesTable.id),
    uniqueId: text('unique_id').notNull(),
    data: text({ mode: 'json' }).$type<unknown>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    unique('items_source_script_id_data_source_id_unique_id_unique').on(
      table.sourceScriptId,
      table.dataSourceId,
      table.uniqueId
    ),
  ]
);
