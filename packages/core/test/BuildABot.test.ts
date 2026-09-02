import type { Server } from 'node:http';
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceContext } from '../src/service/Service.js';

const { fillInContext } = vi.hoisted(() => ({ fillInContext: vi.fn() }));

vi.mock('../src/context/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/context/index.js')>();
  return { ...actual, fillInContext };
});

import { BuildABot } from '../src/BuildABot.js';
import { Service } from '../src/service/Service.js';

class TestService extends Service {
  buildContexts: ServiceContext[] = [];

  async _build(context: ServiceContext): Promise<void> {
    this.buildContexts.push(context);
  }

  async _heal(_context: ServiceContext): Promise<void> {}
  async _sync(_context: ServiceContext): Promise<void> {}
  async _register(_context: ServiceContext): Promise<void> {}

  override openApi() {
    return {
      ...super.openApi(),
      paths: { '/test-service/items': { get: { responses: { 200: { description: 'Items' } } } } },
    };
  }
}

describe('BuildABot', () => {
  beforeEach(() => {
    fillInContext.mockReset();
  });

  it('shares its global context with services without constructing service contexts', async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    const server = {
      address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 4321 }),
      once: vi.fn(),
    } as unknown as Server;
    const app = {
      get: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        queueMicrotask(callback);
        return server;
      }),
    };
    const context = {
      app,
      documentLibrary: {},
      mastra: {},
      storage: { initialize },
    } as unknown as ServiceContext;
    fillInContext.mockResolvedValue(context);

    const service = new TestService({ name: 'test-service' });

    expect(fillInContext).not.toHaveBeenCalled();

    const buildABot = new BuildABot({ services: [service] });
    const callback = vi.fn();
    await expect(buildABot.start({ port: 0 }, callback)).resolves.toMatchObject({ port: 4321 });

    expect(fillInContext).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(service.buildContexts).toEqual([context]);
    expect(app.listen).toHaveBeenCalledWith(0, expect.any(Function));
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ port: 4321, server }));
    expect(app.get).toHaveBeenCalledWith('/openapi.json', expect.any(Function));

    const openApiHandler = app.get.mock.calls.find(([path]) => path === '/openapi.json')?.[1] as (
      req: unknown,
      resp: { json: ReturnType<typeof vi.fn> }
    ) => void;
    const resp = { json: vi.fn() };
    openApiHandler({}, resp);
    expect(resp.json).toHaveBeenCalledWith({
      info: { title: 'BuildABot API', version: '1.0.0' },
      openapi: '3.1.0',
      paths: { '/test-service/items': { get: { responses: { 200: { description: 'Items' } } } } },
    });
  });

  it('starts services and its listener only once', async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    const server = {
      address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 4321 }),
      once: vi.fn(),
    } as unknown as Server;
    const app = {
      get: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        queueMicrotask(callback);
        return server;
      }),
    };
    const context = {
      app,
      documentLibrary: {},
      mastra: {},
      storage: { initialize },
    } as unknown as ServiceContext;
    fillInContext.mockResolvedValue(context);
    const service = new TestService({ name: 'test-service' });
    const buildABot = new BuildABot({ services: [service] });

    await buildABot.start({ port: 0 });
    await buildABot.start({ port: 0 });

    expect(fillInContext).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(service.buildContexts).toEqual([context]);
    expect(app.listen).toHaveBeenCalledTimes(1);
  });

  it('listens on the requested port and serves the combined OpenAPI spec', async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    const app = express();
    const context = {
      app,
      documentLibrary: {},
      mastra: {},
      storage: { initialize },
    } as unknown as ServiceContext;
    fillInContext.mockResolvedValue(context);
    const buildABot = new BuildABot({ services: [new TestService({ name: 'test-service' })] });

    const { port, server } = await buildABot.start({ port: 0 });
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/openapi.json`);

      expect(resp.status).toBe(200);
      await expect(resp.json()).resolves.toMatchObject({
        openapi: '3.1.0',
        paths: { '/test-service/items': expect.any(Object) },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      });
    }
  });
});
