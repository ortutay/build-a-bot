import {
  type GlobalContext,
  type GlobalOptions,
  mergeContext,
  fillInContext,
} from '../context/index.js';

export type ServiceContext = Pick<GlobalContext, 'app' | 'mastra' | 'storage' | 'documentLibrary'>;
export type ServiceOptions = {} & Pick<
  GlobalOptions,
  'app' | 'mastra' | 'storage' | 'documentLibrary'
>;
export type ServiceConstructorOptions = ServiceOptions & { name: string };

export type OpenApiDocument = {
  openapi: '3.1.0';
  info: { title: string; version: string };
  paths: Record<string, unknown>;
};

export abstract class Service<SyncResult = unknown> {
  name: string;
  #context?: Promise<ServiceContext>;
  #options: ServiceOptions;

  constructor(options: ServiceConstructorOptions) {
    this.name = options.name;
    this.#options = options;
  }

  async context(options?: ServiceOptions): Promise<ServiceContext> {
    this.#context ??= fillInContext(this.#options);
    return mergeContext(await this.#context, options);
  }

  async start(options?: ServiceOptions): Promise<void> {
    await this._start(await this.context(options));
  }

  async _start(context: ServiceContext): Promise<void> {
    await this._build(context);
    await this._heal(context);
    const results = await this._sync(context);
    console.log('Got results:', results);
    await this._register(context);
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

  async register(options?: ServiceOptions): Promise<void> {
    return this._register(await this.context(options));
  }

  openApi(): OpenApiDocument {
    return {
      openapi: '3.1.0',
      info: { title: `${this.name} API`, version: '1.0.0' },
      paths: {},
    };
  }

  abstract _build(context: ServiceContext): Promise<void>;
  abstract _heal(context: ServiceContext): Promise<void>;
  abstract _sync(context: ServiceContext): Promise<SyncResult>;
  abstract _register(context: ServiceContext): Promise<void>;
}
