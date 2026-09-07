import { createGlobalContext, type GlobalContext, type GlobalOptions } from './context/index.js';
import { Service } from './service/Service.js';

export type BuildABotOptions = GlobalOptions & {
  services?: Service[];
};

export type BuildABotStartOptions = GlobalOptions;

export class BuildABot {
  services: Service[];
  #context?: Promise<GlobalContext>;
  #init?: Promise<void>;
  #options: GlobalOptions;
  #start?: Promise<void>;

  constructor(options: BuildABotOptions = {}) {
    this.services = options.services ?? [];
    this.#options = options;
  }

  async start(options: BuildABotStartOptions = {}): Promise<void> {
    await (this.#start ??= this.#startOnce(options));
  }

  async #startOnce(options: BuildABotStartOptions): Promise<void> {
    const context = await (this.#context ??= createGlobalContext({
      ...this.#options,
      ...options,
    }));
    await (this.#init ??= context.init());
    await Promise.all(this.services.map((it) => it._start(context)));
  }
}
