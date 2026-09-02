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
    await this._run(context);
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

  async run(options?: ServiceOptions): Promise<void> {
    return this._run(await this.context(options));
  }

  abstract _build(context: ServiceContext): Promise<void>;
  abstract _heal(context: ServiceContext): Promise<void>;
  abstract _sync(context: ServiceContext): Promise<SyncResult>;
  abstract _run(context: ServiceContext): Promise<void>;
}

type Method = any; // TODO: Method is one of 'GET', 'POST', ...

// TODO: can we hook into swagger or something like that?
export type Endpoint = {
  method: Method;
  querySchema: any;
  bodySchema: any;
};
