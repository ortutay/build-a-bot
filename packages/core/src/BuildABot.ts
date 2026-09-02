import { type GlobalContext, type GlobalOptions, fillInContext } from './context/index.js';
import { Service } from './service/Service.js';

export type BuildABotOptions = GlobalOptions & {
  services?: Service[];
};

export class BuildABot {
  services: Service[];
  #context?: Promise<GlobalContext>;
  #initialize?: Promise<void>;
  #options: GlobalOptions;
  #start?: Promise<void>;

  constructor(options: BuildABotOptions = {}) {
    this.services = options.services ?? [];
    this.#options = options;
  }

  async start(context?: GlobalContext): Promise<void> {
    return (this.#start ??= this.#startOnce(context));
  }

  async #startOnce(context?: GlobalContext): Promise<void> {
    context ??= await (this.#context ??= fillInContext(this.#options));
    await (this.#initialize ??= context.storage.initialize());
    await Promise.all(this.services.map((it) => it._start(context)));
  }
}
