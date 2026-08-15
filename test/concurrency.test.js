import { createTool } from '@mastra/core/tools';
import { expect, test, vi } from 'vitest';
import * as z from 'zod';
import { concurrencyInstrument } from '../src/instruments/concurrency.js';

test('concurrency instrument respects the limit and retains argument order', async () => {
  let active = 0;
  let maximumActive = 0;
  const tool = createTool({
    id: 'delayed-echo',
    description: 'Returns its input after a delay.',
    inputSchema: z.object({ value: z.number(), delay: z.number() }),
    outputSchema: z.object({ value: z.number() }),
    execute: async ({ value, delay }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return { value };
    },
  });
  const concurrentTool = await concurrencyInstrument(tool);

  const output = await concurrentTool.execute({
    arguments: [
      { value: 1, delay: 30 },
      { value: 2, delay: 10 },
      { value: 3, delay: 1 },
    ],
    concurrency: { limit: 2, intervalCap: 2, interval: 100 },
  });

  expect(output).toEqual({ results: [{ value: 1 }, { value: 2 }, { value: 3 }] });
  expect(maximumActive).toBe(2);
});

test('random distribution delays a query by a random point in the interval', async () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const tool = createTool({
    id: 'echo',
    description: 'Returns its input.',
    inputSchema: z.object({ value: z.number() }),
    outputSchema: z.object({ value: z.number() }),
    execute: async ({ value }) => ({ value }),
  });
  const concurrentTool = await concurrencyInstrument(tool);
  const start = Date.now();

  try {
    const output = await concurrentTool.execute({
      arguments: [{ value: 1 }],
      concurrency: { limit: 1, intervalCap: 1, interval: 40, distribution: 'random' },
    });

    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
    expect(output).toEqual({ results: [{ value: 1 }] });
  } finally {
    random.mockRestore();
  }
});
