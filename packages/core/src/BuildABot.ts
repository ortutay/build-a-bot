import { type Server } from 'node:http';
import { type Express } from 'express';
import { type GlobalContext, type GlobalOptions, fillInContext } from './context/index.js';
import { type OpenApiDocument, Service } from './service/Service.js';

export type BuildABotOptions = GlobalOptions & {
  services?: Service[];
};

export type BuildABotStartOptions = GlobalOptions & {
  port?: number;
};

export type BuildABotStartResult = {
  port: number;
  server: Server;
};

export type BuildABotStartCallback = (result: BuildABotStartResult) => void;

export class BuildABot {
  services: Service[];
  #context?: Promise<GlobalContext>;
  #initialize?: Promise<void>;
  #options: GlobalOptions;
  #start?: Promise<BuildABotStartResult>;

  constructor(options: BuildABotOptions = {}) {
    this.services = options.services ?? [];
    this.#options = options;
  }

  async start(
    options: BuildABotStartOptions = {},
    callback?: BuildABotStartCallback
  ): Promise<BuildABotStartResult> {
    const result = await (this.#start ??= this.#startOnce(options));
    callback?.(result);
    return result;
  }

  async #startOnce(options: BuildABotStartOptions): Promise<BuildABotStartResult> {
    const { port = 3000, ...contextOptions } = options;
    const context = await (this.#context ??= fillInContext({
      ...this.#options,
      ...contextOptions,
    }));
    await (this.#initialize ??= context.storage.initialize());
    await Promise.all(this.services.map((it) => it._start(context)));
    context.app.get('/', (_req, resp) => {
      resp.json({ services: this.services.map((service) => service.name) });
    });
    const openApi = this.#openApi();
    context.app.get('/openapi.json', (_req, resp) => {
      resp.json(openApi);
    });

    const server = await this.#listen(context.app, port);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not determine the listening port');
    }

    return { port: address.port, server };
  }

  #openApi(): OpenApiDocument {
    const paths: Record<string, unknown> = {};
    for (const service of this.services) {
      for (const [path, definition] of Object.entries(service.openApi().paths)) {
        if (paths[path]) {
          throw new Error(`Duplicate OpenAPI path: ${path}`);
        }
        paths[path] = definition;
      }
    }

    return {
      openapi: '3.1.0',
      info: { title: 'BuildABot API', version: '1.0.0' },
      paths,
    };
  }

  #listen(app: Express, port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = app.listen(port, () => resolve(server));
      server.once('error', reject);
    });
  }
}
