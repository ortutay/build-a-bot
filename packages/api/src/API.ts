import { createServer, type Server } from 'node:http';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { DataService } from '@build-a-bot/core';
import { DataServiceAPI } from './service/DataServiceAPI.js';

export const defaultApiPort = 3000;

export type APIOptions = { services: DataService[] };
export type APIStartOptions = { host?: string; port?: number };
export type APIStartResult = { close: () => Promise<void>; port: number };
export type OpenApiDocument = {
  info: { title: string; version: string };
  openapi: '3.1.0';
  paths: Record<string, unknown>;
};

const listen = async (server: Server, host: string, port: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
};

export class API {
  app: Express;
  dataServices: DataServiceAPI[];
  services: DataService[];
  #start?: Promise<APIStartResult>;

  constructor(options: APIOptions) {
    this.app = express();
    this.services = options.services;
    this.dataServices = this.services.map((dataService) => new DataServiceAPI({ dataService }));
    this.#register();
  }

  openApi(): OpenApiDocument {
    const paths: Record<string, unknown> = {};
    for (const service of this.dataServices) {
      for (const [path, definition] of Object.entries(service.openApi())) {
        if (paths[path]) {
          throw new Error(`Duplicate OpenAPI path: ${path}`);
        }
        paths[path] = definition;
      }
    }

    return {
      info: { title: 'BuildABot API', version: '1.0.0' },
      openapi: '3.1.0',
      paths,
    };
  }

  async start(options: APIStartOptions = {}): Promise<APIStartResult> {
    return (this.#start ??= this.#startOnce(options));
  }

  #register(): void {
    this.app.use(express.json());
    this.app.get('/', (_req, resp) => {
      resp.json({ services: this.services.map((service) => service.name) });
    });
    this.app.get('/openapi.json', (_req, resp) => {
      resp.json(this.openApi());
    });
    for (const service of this.dataServices) {
      service.register(this.app);
    }
    const onError: ErrorRequestHandler = (e, _req, resp, next) => {
      if (resp.headersSent) {
        next(e);
        return;
      }
      const status = Number(e?.status);
      if (Number.isInteger(status) && status >= 400 && status < 500) {
        resp.status(status).json({ error: 'Invalid request body' });
        return;
      }
      console.error('API request failed', e);
      resp.status(500).json({ error: 'Internal server error' });
    };
    this.app.use(onError);
  }

  async #startOnce({ host = '127.0.0.1', port }: APIStartOptions): Promise<APIStartResult> {
    await DataService.sharedContext(this.services);
    for (const service of this.services) {
      await service.start();
    }

    for (let candidatePort = port ?? defaultApiPort; candidatePort <= 65535; candidatePort++) {
      const server = createServer(this.app);
      try {
        await listen(server, host, candidatePort);
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Could not determine the listening port');
        }

        return {
          port: address.port,
          close: () =>
            new Promise<void>((resolve, reject) => {
              server.close((e) => (e ? reject(e) : resolve()));
            }),
        };
      } catch (e) {
        if (port !== undefined || (e as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
          throw e;
        }
      }
    }

    throw new Error(`No available API port at or above ${defaultApiPort}.`);
  }
}
