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
  async _run(_context: ServiceContext): Promise<void> {}
}

describe('BuildABot', () => {
  beforeEach(() => {
    fillInContext.mockReset();
  });

  it('shares its global context with services without constructing service contexts', async () => {
    const context = {} as ServiceContext;
    fillInContext.mockResolvedValue(context);

    const service = new TestService({ name: 'test-service' });

    expect(fillInContext).not.toHaveBeenCalled();

    const buildABot = new BuildABot({ services: [service] });
    await buildABot.start();

    expect(fillInContext).toHaveBeenCalledTimes(1);
    expect(service.buildContexts).toEqual([context]);
  });

  it('does not construct a global context when one is provided to start', async () => {
    const context = {} as ServiceContext;
    const service = new TestService({ name: 'test-service' });
    const buildABot = new BuildABot({ services: [service] });

    await buildABot.start(context);

    expect(fillInContext).not.toHaveBeenCalled();
    expect(service.buildContexts).toEqual([context]);
  });
});
