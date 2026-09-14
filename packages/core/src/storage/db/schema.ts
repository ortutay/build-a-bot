import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { IdentityConfig } from '../../service/identity.js';
import { srid } from '../../util/index.js';

export const runStatuses = ['active', 'done', 'error'] as const;
export type RunStatus = (typeof runStatuses)[number];

const currentTimestamp = (): string => new Date().toISOString();

const createdAt = () => text('created_at').notNull().$defaultFn(currentTimestamp);
const updatedAt = () =>
  text('updated_at').notNull().$defaultFn(currentTimestamp).$onUpdateFn(currentTimestamp);

export const accountsTable = sqliteTable('accounts', {
  id: text()
    .primaryKey()
    .$defaultFn(() => srid()),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  username: text().notNull().unique(),
});

export const dataServicesTable = sqliteTable(
  'data_services',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => srid()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    accountId: text('account_id')
      .notNull()
      .references(() => accountsTable.id),
    name: text().notNull(),
    identity: text('identity', { mode: 'json' }).$type<IdentityConfig>(),
    itemSchema: text('item_schema', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => [unique('data_services_account_id_name_unique').on(table.accountId, table.name)]
);

export const scriptsTable = sqliteTable(
  'scripts',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => srid()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    active: integer({ mode: 'boolean' }).notNull().default(true),
    dataServiceId: text('data_service_id')
      .notNull()
      .references(() => dataServicesTable.id),
    name: text().notNull(),
    code: text().notNull(),
    buildInput: text('build_input', { mode: 'json' }).$type<Record<string, unknown>>(),
    exports: text({ mode: 'json' }).$type<string[]>().notNull(),
    vmContext: text('vm_context', { mode: 'json' }).$type<string[]>().notNull(),
    modules: text({ mode: 'json' }).$type<string[]>().notNull(),
    tools: text({ mode: 'json' }).$type<string[]>().notNull(),
  },
  (table) => [
    uniqueIndex('scripts_active_data_service_id_name_unique')
      .on(table.dataServiceId, table.name)
      .where(sql`${table.active} = 1`),
  ]
);

export const dataSourcesTable = sqliteTable(
  'data_sources',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => srid()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    dataServiceId: text('data_service_id')
      .notNull()
      .references(() => dataServicesTable.id),
    url: text().notNull(),
  },
  (table) => [unique('data_sources_data_service_id_url_unique').on(table.dataServiceId, table.url)]
);

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
  createdAt: createdAt(),
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
    sourceUrl: text('source_url').notNull(),
    uniqueId: text('unique_id').notNull(),
    data: text({ mode: 'json' }).$type<unknown>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('items_source_script_id_source_url_unique_id_unique').on(
      table.sourceScriptId,
      table.sourceUrl,
      table.uniqueId
    ),
  ]
);
