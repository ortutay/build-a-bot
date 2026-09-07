import { createGlobalContext, type GlobalContext, type GlobalOptions } from '../context/index.js';
import { Account } from '../account/Account.js';
import type { ISerializable } from '../interface/ISerializable.js';
import type { ISaveable } from '../interface/ISaveable.js';
import { log } from '../internal/logger.js';
import type { StorageTransaction } from '../storage/Storage.js';
import { servicesTable } from '../storage/db/schema.js';
import { findById as findServiceById } from '../storage/helpers.js';

export type ServiceOptions = GlobalOptions & { context?: GlobalContext };
export type ServiceContext = GlobalContext;
export type ServiceConfig = { name: string; type: string };

export type ServiceConstructorOptions = ServiceOptions & {
  id?: string;
  account?: Account;
  name: string;
};

export abstract class Service<SyncResult = unknown>
  implements ISerializable<ServiceConfig>, ISaveable
{
  id: string | null;
  account: Account | null;
  name: string;
  #context?: ServiceContext;
  #contextPromise?: Promise<ServiceContext>;
  #options: ServiceOptions;

  constructor(options: ServiceConstructorOptions) {
    this.id = options.id ?? null;
    this.name = options.name;
    this.account = options.account ?? null;
    this.#options = options;
    this.#context = options.context;
  }

  static async findById(context: GlobalContext, id: string): Promise<Service | null> {
    const service = await findServiceById(servicesTable, context, id);

    return service ? Service.#fromRow(context, service) : null;
  }

  static async sharedContext(services: readonly Service[]): Promise<ServiceContext> {
    let context: ServiceContext | undefined;
    for (const service of services) {
      const candidate = service.#context ?? (await service.#contextPromise);
      if (candidate && context && candidate !== context) {
        throw new Error('Services must use the same context');
      }

      context ??= candidate;
    }

    context ??= await createGlobalContext();
    for (const service of services) {
      const candidate = service.#context ?? (await service.#contextPromise);
      if (candidate && candidate !== context) {
        throw new Error('Services must use the same context');
      }
      if (!candidate) {
        service.bindContext(context);
      }
    }

    return context;
  }

  abstract readonly type: string;

  abstract save(tx?: StorageTransaction): Promise<void>;

  abstract remove(tx?: StorageTransaction): Promise<void>;

  abstract dump(): ServiceConfig;

  async context(options?: ServiceOptions): Promise<ServiceContext> {
    if (options?.context) {
      this.bindContext(options.context);
    }
    if (this.#context) {
      return this.#context;
    }

    const context = await (this.#contextPromise ??= createGlobalContext({
      ...this.#options,
      ...options,
    }));
    this.#context = context;
    return context;
  }

  bindContext(context: ServiceContext): void {
    if (this.#context && this.#context !== context) {
      throw new Error('Service already has a different bound context');
    }
    if (this.#contextPromise && !this.#context) {
      throw new Error('Service context is already being created');
    }

    this.#context = context;
    this.#contextPromise = Promise.resolve(context);
  }

  async start(options?: ServiceOptions): Promise<void> {
    await this._start(await this.context(options));
  }

  async _start(context: ServiceContext): Promise<void> {
    this.bindContext(context);
    await this._build(context);
    await this._heal(context);
    const results = await this._sync(context);
    log.info(
      `Service sync complete: service=${this.name}, resultCount=${
        (results as { results?: unknown[] } | null)?.results?.length
      }`
    );
  }

  async build(options?: ServiceOptions): Promise<void> {
    return this._build(await this.context(options));
  }

  async heal(options?: ServiceOptions): Promise<void> {
    return this._heal(await this.context(options));
  }

  async sync(options?: ServiceOptions): Promise<SyncResult> {
    return this._sync(await this.context(options));
  }

  abstract _build(context: ServiceContext): Promise<void>;
  abstract _heal(context: ServiceContext): Promise<void>;
  abstract _sync(context: ServiceContext): Promise<SyncResult>;

  static async #fromRow(
    context: GlobalContext,
    service: typeof servicesTable.$inferSelect
  ): Promise<Service> {
    switch (service.type) {
      case 'data': {
        const { DataService } = await import('./data/DataService.js');
        const dataService = await DataService.findById(context, service.id);
        if (!dataService) {
          throw new Error(`Could not load data service: ${service.id}`);
        }

        return dataService;
      }
      default:
        throw new Error(`Unsupported service type: ${service.type}`);
    }
  }
}
