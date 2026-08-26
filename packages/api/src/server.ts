import { createServer, type Server } from 'node:http';
import { BuildABot } from '@build-a-bot/core';
import { createApi } from './createApi.js';

export const defaultApiPort = 3000;

export type ApiServerOptions = {
  host?: string;
  port?: number;
};

export type ApiServer = {
  port: number;
  close: () => Promise<void>;
};

const listen = async (server: Server, host: string, port: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
};

export const startApiServer = async (
  buildABot: BuildABot,
  { host = '127.0.0.1', port }: ApiServerOptions = {}
): Promise<ApiServer> => {
  for (let candidatePort = port ?? defaultApiPort; candidatePort <= 65535; candidatePort++) {
    const server = createServer(createApi(buildABot));

    try {
      await listen(server, host, candidatePort);
      return {
        port: candidatePort,
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
};
