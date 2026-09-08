import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { GlobalContext } from '../src/context/index.js';

const { createGlobalContext } = vi.hoisted(() => ({ createGlobalContext: vi.fn() }));

vi.mock('../src/context/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/context/index.js')>();
  return { ...actual, createGlobalContext };
});

import { BuildABot } from '../src/BuildABot.js';
import { DataService } from '../src/service/DataService.js';

const testService = (): DataService =>
  new DataService({ itemSchema: z.object({}), name: 'test-service', sources: [] });

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
    } as unknown as GlobalContext;
    createGlobalContext.mockResolvedValue(context);
    const service = testService();
    const start = vi.spyOn(service, 'start').mockResolvedValue(undefined);
    const buildABot = new BuildABot({ services: [service] });

    await expect(buildABot.start()).resolves.toBeUndefined();

    expect(createGlobalContext).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith();
    await expect(service.context()).resolves.toStrictEqual(context);
  });

  it('starts services only once', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const context = {
      documentLibrary: {},
      mastra: {},
      init,
      storage: {},
    } as unknown as GlobalContext;
    createGlobalContext.mockResolvedValue(context);
    const service = testService();
    const start = vi.spyOn(service, 'start').mockImplementation(async () => undefined);
    const buildABot = new BuildABot({ services: [service] });

    await buildABot.start();
    await buildABot.start();

    expect(createGlobalContext).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
