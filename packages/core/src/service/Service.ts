import {
  type GlobalContext,
  type GlobalOptions,
  mergeContext,
  fillInContext,
} from '../context/index.js';

export type ServiceContext = Pick<GlobalContext, 'mastra' | 'storage' | 'documentLibrary'>;
export type ServiceOptions = {} & Pick<GlobalOptions, 'mastra' | 'storage' | 'documentLibrary'>;
export type ServiceConstructorOptions = ServiceOptions & { id: string };

export abstract class Service {
  id: string;
  #context: Promise<ServiceContext>;

  constructor(options: ServiceConstructorOptions) {
    this.id = options.id;
    this.#context = fillInContext(options);
  }

  async context(options?: ServiceOptions): Promise<ServiceContext> {
    return mergeContext(await this.#context, options);
  }

  async start(options?: ServiceOptions): Promise<void> {
    await this._build(await this.context(options));
    // TODO: rest
  }

  async build(options?: ServiceOptions): Promise<void> {
    return this._build(await this.context(options));
  }

  async heal(options?: ServiceOptions): Promise<void> {
    return this._heal(await this.context(options));
  }

  async sync(options?: ServiceOptions): Promise<void> {
    return this._sync(await this.context(options));
  }

  async run(options?: ServiceOptions): Promise<void> {
    return this._run(await this.context(options));
  }

  abstract _build(context: ServiceContext): Promise<void>;
  abstract _heal(context: ServiceContext): Promise<void>;
  abstract _sync(context: ServiceContext): Promise<void>;
  abstract _run(context: ServiceContext): Promise<void>;
}

type Method = any; // TODO: Method is one of 'GET', 'POST', ...

// TODO: can we hook into swagger or something like that?
export type Endpoint = {
  method: Method;
  querySchema: any;
  bodySchema: any;
};
