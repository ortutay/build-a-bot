import { type GlobalContext, type GlobalOptions, fillInContext } from './context/index.js';
import { Service } from './service/Service.js';

export type BuildABotOptions = GlobalOptions & {
  services?: Record<string, Service>;
};

export class BuildABot {
  services: Record<string, Service>;
  #context: Promise<GlobalContext>;

  constructor(options: BuildABotOptions) {
    this.services = options.services || {};
    this.#context = fillInContext(options);
  }

  async start(context?: GlobalContext): Promise<void> {
    context ??= await this.#context;
    await Promise.all(Object.values(this.services).map((it) => it.start(context)));

    // start all services
    // build all services
    // heal all services
    // sync all services
  }
}
