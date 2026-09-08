import { UsesContext, type UsesContextOptions } from './context/UsesContext.js';
import { DataService } from './service/DataService.js';

export type BuildABotOptions = UsesContextOptions & {
  services?: DataService[];
};

export class BuildABot extends UsesContext {
  services: DataService[];
  #start?: Promise<void>;

  constructor(options: BuildABotOptions = {}) {
    super(options);
    this.services = options.services ?? [];
  }

  async start(): Promise<void> {
    await (this.#start ??= this.#startOnce());
  }

  async #startOnce(): Promise<void> {
    const context = await this.context();
    await Promise.all(
      this.services.map(async (service) => {
        service.bindContext(context);
        await service.start();
      })
    );
  }
}
