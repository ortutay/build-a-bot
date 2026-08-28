import { type GlobalContext, type GlobalOptions, fillInContext } from '../context/index.js';

export type ServiceContext = Pick<GlobalContext, 'mastra' | 'storage' | 'documentLibrary'>;
export type ServiceOptions = {
  id: string;
} & Pick<GlobalOptions, 'mastra' | 'storage' | 'documentLibrary'>;

export abstract class Service {
  id: string;
  #context: Promise<ServiceContext>;

  constructor(options: ServiceOptions) {
    this.id = options.id;
    this.#context = fillInContext(options);
  }

  async start(context?: ServiceContext): Promise<void> {
    context ??= await this.#context;
    await this.build(context);
    // TODO: rest
  }

  async build(context?: ServiceContext): Promise<void> {
    return this._build(context ?? (await this.#context));
  }
  abstract _build(context?: ServiceContext): Promise<void>;

  abstract heal(context?: ServiceContext): Promise<void>;
  abstract sync(context?: ServiceContext): Promise<void>;
  abstract run(context?: ServiceContext): Promise<void>;
}

type Method = any; // TODO: Method is one of 'GET', 'POST', ...

// TODO: can we hook into swagger or something like that?
export type Endpoint = {
  method: Method;
  querySchema: any;
  bodySchema: any;
};
