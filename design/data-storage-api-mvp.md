# Data Storage and API MVP

## Scope

This change removes `BuildABot` from the public configuration flow. A service is independently constructed, started, queried, saved, and mounted in the API.

```ts
// Below is from @build-a-bot/core
const realEstate = new DataService({
  name: 'real-estate-data-service',
  sources: [new DataSource({ url: 'https://example.com/agents' })],
  itemSchema,
});

await realEstate.start();
const items = await realEstate.list({ limit: 100, page: 2 });

// Optional: from @build-a-bot/api
const api = new API({ services: [realEstate] });
const server = await api.start();
```

## Context

Replace `fillInContext()` with `createGlobalContext()`.

```ts
const context = await createGlobalContext({ storage, mastra, documentLibrary });
```

`GlobalContext` is an immutable runtime class that owns `storage`, `mastra`, and `documentLibrary`. `createGlobalContext()` fills in omitted dependencies with local defaults. `context.init()` is the class method that initializes storage once; configuration persistence calls it before database access.

```ts
class GlobalContext {
  readonly storage: Storage;
  readonly mastra: Mastra;
  readonly documentLibrary: DocumentLibrary;

  constructor(options: Required<GlobalOptions>);
  init(): Promise<void>;
}
```

Configuration objects extend `UsesContext`. Constructors remain context-free: an explicit `options.context` binds it at construction; otherwise, the first parent or runtime operation binds it. A standalone operation with no bound context creates a local one through `createGlobalContext()`.

```ts
class UsesContext {
  constructor({ context }: { context?: GlobalContext } = {});

  async context(): Promise<GlobalContext> {
    this.#context ??= await createGlobalContext();
    await this.#context.init();
    return this.#context;
  }
}
```

Parents bind their children to the same context before saving or starting them. An already-bound child may only be used by a parent with that exact same context; a different context is an error. This lets `new DataSource(...)` remain context-free while ensuring it shares its `DataService` context.

Platform code may pass one shared `GlobalContext` as the single `context` option when constructing or loading configuration objects. A bound context cannot be overridden.

`bindContext(context)` is an internal `UsesContext` method. It binds an unbound object or verifies the same existing context; it never replaces a different one. `context()` is the public read method for every context-using object: it returns an initialized bound context or creates, initializes, and binds a local default. Instance methods use `const context = await this.context()` and do not call `context.init()` separately.

## Development migration policy

This is a development-stage schema refactor. Keep one reset migration that drops the application tables and recreates the current schema; do not add compatibility migrations or backfills. It deliberately removes local configuration and runtime data when first applied to an existing development database. The reset migration leaves Drizzle's migration journal intact. Replace it with normal incremental migrations before persistent user data is supported.

## Accounts and persistence

Add `Account` at `src/account/Account.ts`.

Configuration tables use database IDs as their persistence identity. Stable semantic lookups remain scoped to their parents: account `username`, service `(accountId, name)`, and source `(dataServiceId, url)`.

Service names remain URL-safe slugs.

`local` is a reserved username. It is a normal persisted account row, created automatically in local storage on first service save, via `Account.local()`. Local users never need to construct an `Account`.

Persistence flows downstream. `DataService` requires a saved owning `Account`; local initialization creates the special `local` account before saving the service. `DataSource` requires an existing saved `DataService`. `DataService.save()` writes its `data_services` row and sources in one transaction. Data services upsert by `(accountId, name)` and sources upsert by `(dataServiceId, url)`. Changing a service name therefore creates a new service. Old services are retained until explicit deletion or archival is added later.

`DataService.remove()` removes the base service row and its owned `data_services` and `data_sources` rows in one transaction. It does not remove the owning account, including the automatically-created `local` account.

## Configuration objects

Configuration objects are defined in code, encompassing DataService, DataSource, Account (see below), and more objects in the future.

Every configuration object has a database `id`, used for foreign keys. Its semantic lookup is defined by the owning class and its parent scope.

Configuration objects support dumps, which are portable, method-free, JSON-compatible plain objects. They never contain database IDs, timestamps, runtime context, scripts, items, runs, or results.

Use `Config` as the suffix for their types: `AccountConfig`, `DataServiceConfig`, and `DataSourceConfig`. `JSON.stringify(service.dump())` produces JSON text when needed.

Each configuration constructor's options extend its config type with runtime-only fields, rather than repeating configuration fields. For example, `AccountOptions = AccountConfig & UsesContextOptions & { id?: string }`. `load(config, context)` constructs with `{ context, ...config }`. Constructors accept `context` as their only infrastructure dependency; callers first create a `GlobalContext` when they need to supply storage, Mastra, or a document library.

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = Record<string, JsonValue>;

// Export from Storage.ts. This aliases the actual Drizzle transaction passed
// to Storage.db.transaction(), not a local wrapper.
type StorageDb = Storage['db'];
type StorageTransaction = Parameters<Parameters<StorageDb['transaction']>[0]>[0];

interface ISerializable<TConfig> {
  dump(): TConfig;
}

interface ISaveable {
  id: string | null;
  save(tx?: StorageTransaction): Promise<void>;
  remove(tx?: StorageTransaction): Promise<void>;
}

interface ISaveableClass<T> {
  findById(context: GlobalContext, id: string): Promise<T | null>;
}
```

`Storage.fillInTransaction(tx, fn)` runs `fn(tx)` with the supplied Drizzle transaction or opens one around `fn` when `tx` is omitted. Drizzle transactions are callback-scoped, so a helper cannot safely create a transaction and return it for use after the helper finishes.

Each configuration class implements `ISaveable` and provides its own static `load()` method. Static methods are not part of TypeScript's instance `implements` contract, so `ISaveableClass` documents their constructor-side contract.

Every class exposes its own semantic lookup: `findByUsername(context, username)`, `findByName(context, accountId, name)`, or `findByUrl(context, dataServiceId, url)`. A generic `save()` is not useful: each class owns its row mapping, uniqueness constraint, parent-save order, and child-save behavior.

`DataService` owns its complete configuration dump: name, item schema, and sources. Its constructor accepts either a Zod schema or JSON Schema. It normalizes both to a canonical JSON Schema for dumps and persistence, while retaining a runtime Zod schema for validation.

`createdAt` and `updatedAt` are schema-level Drizzle defaults. `updatedAt` uses `$onUpdateFn()` so application-level updates and upserts do not set timestamps in every model.

In implementation, verify dump/load symmetry: `dump()` → `load()` → `dump()` must produce the same configuration object.

Configuration objects are synchronized at runtime, with their parent-scoped semantic lookup used to determine insertion versus updates. They are not removed except by an explicit `.remove()` call. A later Studio UI will make this easier.

## Scripts and runtime records

`Script` is a derived runtime record, not configuration. It must no longer create or locate a data service by name; it is always saved with an existing `dataServiceId`.

Rename Script's persisted capability list from `context` to `vmContext`. `GlobalContext` is runtime infrastructure and must never be serialized into a script.

`Item`, `Run`, `Script`, and result rows are runtime data. They may dump/load their own data representations, but they do not participate in parent configuration synchronization. Runtime records that perform persistence are constructed or loaded with a bound `GlobalContext`; instance methods use that context, while static find methods receive it because they create the instance.

## API

The local API receives service instances and routes directly to them:

```ts
const api = new API({ services: [realEstate] });
const server = await api.start();
```

`API({ services })` mandates one `GlobalContext`. Before starting the server, `API.start()` calls `DataService.sharedContext(services)`. It reuses one existing bound context when present, or creates one when every service is unbound, then binds all unbound services to it. If supplied services resolve to different contexts, `start()` rejects. This ensures API-local services share one database, Mastra instance, and document library.

Service routes use the local account namespace:

```text
/local/:serviceName/items
/local/:serviceName/items/:id
/local/:serviceName/sync
```

Service names must be URL-safe slugs. `POST /sync` may be synchronous in MVP, but calls the explicit `service.sync()` method.

## Explicitly out of scope

Platform implementation, cloud account routing, GitHub integrations and push ingestion, service visibility, collaborators, organization support, forks, and immutable configuration revision history are not part of this change. The account namespace and configuration-object format keep the storage model ready for those later additions.

## Canonical class, schema, and method reference

Every primary-key identifier is generated with `srid()`. All tables put `created_at` and `updated_at` immediately after their identity column.

### Configuration classes

#### `Account`

```text
accounts
- id: srid primary key
- created_at: timestamp, not null
- updated_at: timestamp, not null
- username: varchar, unique, not null
```

```ts
type AccountConfig = { username: string };
type AccountOptions = AccountConfig & { context: GlobalContext; id?: string };

class Account implements ISerializable<AccountConfig>, ISaveable {
  id: string | null;
  username: string;

  constructor(options: AccountOptions);
  static findById(context: GlobalContext, id: string): Promise<Account | null>;
  static findByUsername(context: GlobalContext, username: string): Promise<Account | null>;
  static local(context: GlobalContext): Promise<Account>;
  save(tx?: StorageTransaction): Promise<void>;
  remove(tx?: StorageTransaction): Promise<void>;
  dump(): AccountConfig;
  static load(config: AccountConfig, context: GlobalContext): Account;
}
```

#### `DataService`

```text
data_services
- id: srid primary key
- created_at: timestamp, not null
- updated_at: timestamp, not null
- account_id: FK accounts.id, not null
- name: varchar, not null
- item_schema: json, not null
- unique(account_id, name)
```

```ts
type DataServiceConfig = {
  name: string;
  itemSchema: JsonObject;
  sources: DataSourceConfig[];
};

class DataService implements ISerializable<DataServiceConfig>, ISaveable {
  id: string | null;
  account: Account | null;
  name: string;
  itemSchema: z.ZodType;
  sources: DataSource[];

  constructor({ context?, account?, id?, name, itemSchema, sources });
  context(): Promise<GlobalContext>;
  bindContext(context: GlobalContext): void;
  static sharedContext(services: readonly DataService[]): Promise<GlobalContext>;
  static findById(context: GlobalContext, id: string): Promise<DataService | null>;
  static findByName(context: GlobalContext, accountId: string, name: string): Promise<DataService | null>;
  save(tx?: StorageTransaction): Promise<void>;
  remove(tx?: StorageTransaction): Promise<void>;
  dump(): DataServiceConfig;
  static load(config: DataServiceConfig, context?: GlobalContext, account?: Account): DataService;
  list({ limit?, page? }?): Promise<DataServiceListResult>;
  detail(uniqueId: string): Promise<unknown | null>;
  start(): Promise<void>;
  build(): Promise<void>;
  heal(): Promise<void>;
  sync(): Promise<DataServiceResult>;
}
```

#### `DataSource`

```text
data_sources
- id: srid primary key
- created_at: timestamp, not null
- updated_at: timestamp, not null
- data_service_id: FK data_services.id, not null
- url: varchar, not null
- unique(data_service_id, url)
```

```ts
type DataSourceConfig = { url: string };

class DataSource implements ISerializable<DataSourceConfig>, ISaveable {
  id: string | null;
  dataServiceId: string | null;
  url: Url;

  constructor({ context?, id?, dataServiceId?, url });
  bindContext(context: GlobalContext): void;
  static findById(context: GlobalContext, id: string): Promise<DataSource | null>;
  static findByUrl(context: GlobalContext, dataServiceId: string, url: string): Promise<DataSource | null>;
  save(tx?: StorageTransaction): Promise<void>;
  remove(tx?: StorageTransaction): Promise<void>;
  dump(): DataSourceConfig;
  static load(config: DataSourceConfig, context?: GlobalContext): DataSource;
}
```

### Runtime data record classes

`ScriptData`, `RunData`, and `ItemData` are JSON-compatible, row-shaped data types used only by their corresponding `dump()` and `load()` methods.

#### `Script`

`Script` is runtime data, not configuration. Its name is scoped to its owning `dataServiceId`.

```text
scripts
- id: srid primary key
- created_at: timestamp, not null
- updated_at: timestamp, not null
- data_service_id: FK data_services.id, not null
- name: varchar, not null
- code: text, not null
- build_input: json, nullable
- exports: json, not null
- vm_context: json, not null
- modules: json, not null
- tools: json, not null
- unique(service_id, name)
```

```ts
class Script {
  id: string | null;
  dataServiceId: string;
  name: string;
  code: string;
  vmContext: string[];

  constructor({ context, ...options }: ScriptOptions & { context: GlobalContext });
  static findById(context: GlobalContext, id: string): Promise<Script | null>;
  static findByName(
    context: GlobalContext,
    dataServiceId: string,
    name: string
  ): Promise<Script | null>;
  save(tx?: StorageTransaction): Promise<void>;
  compile(): Promise<Bot>;
  remove(tx?: StorageTransaction): Promise<void>;
  dump(): ScriptData;
  static load(data: ScriptData, context: GlobalContext): Script;
}
```

#### `Run`

```text
runs
- id: srid primary key
- created_at: timestamp, not null
- updated_at: timestamp, not null
- script_id: FK scripts.id, not null
- start_time: timestamp, not null
- end_time: timestamp, nullable
- input: json, not null
- status: varchar, not null
- error: json, nullable
```

```ts
class Run {
  id: string | null;
  scriptId: string;
  status: RunStatus;

  constructor({ context, ...options }: RunOptions & { context: GlobalContext });
  save(tx?: StorageTransaction): Promise<void>;
  complete(results: unknown[], tx?: StorageTransaction): Promise<void>;
  fail(error: unknown, tx?: StorageTransaction): Promise<void>;
  dump(): RunData;
  static load(data: RunData, context: GlobalContext): Run;
}
```

#### `Item`

```text
items
- id: srid primary key
- created_at: timestamp, not null
- updated_at: timestamp, not null
- source_script_id: FK scripts.id, not null
- data_source_id: FK data_sources.id, not null
- unique_id: varchar, not null
- data: json, not null
- unique(source_script_id, data_source_id, unique_id)
```

```ts
class Item {
  id: string | null;
  sourceScriptId: string;
  dataSourceId: string;
  uniqueId: string;
  data: unknown;

  constructor({ context, ...options }: ItemOptions & { context: GlobalContext });
  save(tx?: StorageTransaction): Promise<void>;
  remove(tx?: StorageTransaction): Promise<void>;
  dump(): ItemData;
  static load(data: ItemData, context: GlobalContext): Item;
}
```

#### Result rows

Results are immutable rows written by `Run.complete()`. There is no separate `Result` class in this change.

```text
results
- id: srid primary key
- created_at: timestamp, not null
- updated_at: timestamp, not null
- run_id: FK runs.id, not null
- data: json, not null
```
