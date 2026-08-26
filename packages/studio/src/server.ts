import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

export const defaultStudioPort = 5173;

export type StudioServerOptions = {
  apiUrl: string;
  host?: string;
  port?: number;
};

export type StudioServer = {
  port: number;
  close: () => Promise<void>;
};

export const startStudioServer = async ({
  apiUrl,
  host = '127.0.0.1',
  port,
}: StudioServerOptions): Promise<StudioServer> => {
  const studioRoot = new URL('../', import.meta.url).pathname;
  const server = await createServer({
    configFile: false,
    root: studioRoot,
    plugins: [react()],
    server: {
      host,
      port: port ?? defaultStudioPort,
      strictPort: port !== undefined,
      proxy: {
        '/api': apiUrl,
      },
    },
  });

  await server.listen();
  const address = server.httpServer?.address();

  if (!address || typeof address === 'string') {
    throw new Error('Studio did not expose a TCP port.');
  }

  return {
    port: address.port,
    close: () => server.close(),
  };
};
