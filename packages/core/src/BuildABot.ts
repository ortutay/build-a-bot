import { Storage } from './storage/Storage.js';
import { Service } from './service/Service.js';

export type BuildABotOptions = {
  storage?: Storage;
  services?: Service[];
};

export class BuildABot {
  storage: Storage;
  services: Service[];

  constructor(options: BuildABotOptions) {
    this.storage = options.storage || new Storage();
    this.services = options.services || [];
  }

  async start(): Promise<void> {
    await Promise.all(this.services.map((it) => it.start()));
    // start all services
    // build all services
    // heal all services
    // sync all services
  }
}
