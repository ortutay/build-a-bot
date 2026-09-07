import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceContext } from '../src/service/Service.js';

const { createGlobalContext } = vi.hoisted(() => ({ createGlobalContext: vi.fn() }));

vi.mock('../src/context/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/context/index.js')>();
  return { ...actual, createGlobalContext };
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
}

describe('BuildABot', () => {
  beforeEach(() => {
    createGlobalContext.mockReset();
  });

  it('shares its global context with services without constructing service contexts', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const context = {
      documentLibrary: {},
      mastra: {},
      init,
      storage: {},
    } as unknown as ServiceContext;
    createGlobalContext.mockResolvedValue(context);
    const service = new TestService({ name: 'test-service' });
    const buildABot = new BuildABot({ services: [service] });

    await expect(buildABot.start()).resolves.toBeUndefined();

    expect(createGlobalContext).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(service.buildContexts).toEqual([context]);
    await expect(service.context()).resolves.toStrictEqual(context);
  });

  it('starts services only once', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const context = {
      documentLibrary: {},
      mastra: {},
      init,
      storage: {},
    } as unknown as ServiceContext;
    createGlobalContext.mockResolvedValue(context);
    const service = new TestService({ name: 'test-service' });
    const buildABot = new BuildABot({ services: [service] });

    await buildABot.start();
    await buildABot.start();

    expect(createGlobalContext).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(service.buildContexts).toEqual([context]);
  });
});
