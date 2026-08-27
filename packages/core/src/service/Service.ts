import { Storage } from '../storage/Storage.js';

export type ServiceOptions = {
  storage?: Storage;
};

export abstract class Service {
  storage: Storage;

  constructor(options: ServiceOptions) {
    // TODO: what is default storage? should it be singleton?
    this.storage = options.storage ?? new Storage();
  }

  async start(): Promise<void> {
    await this.build();
    await this.heal();
    await this.sync();
    await this.run();
  }

  async build(): Promise<void> {}
  async heal(): Promise<void> {}
  async sync(): Promise<void> {}
  async run(): Promise<void> {}
}

export type StartServiceOptions = {};

type Method = any; // TODO: Method is one of 'GET', 'POST', ...

// TODO: can we hook into swagger or something like that?
export type Endpoint = {
  method: Method;
  querySchema: any;
  bodySchema: any;
};

// export type Service = {
//   endpoints: Endpoint[],

//   start(options: StartInterfaceOptions): Promise<void>,
// }
