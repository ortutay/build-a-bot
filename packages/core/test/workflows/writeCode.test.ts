import { expect, it, vi } from 'vitest';
import { Bot } from '../../src/bot/Bot.js';
import { Compiler } from '../../src/compile/Compiler.js';
import { planStep, writeCodeStep } from '../../src/mastra/workflows/steps.js';

const code = `export const itemSchema = { type: 'object' };
export const uniqueId = item => item.id;
export const check = async url => true;
export const run = async url => [];`;
const grouping = {
  groupingName: 'jobs',
  groupingDescription: 'Jobs',
  goal: 'Extract jobs',
  urls: ['https://example.test/jobs'],
  report: 'Use the verified endpoint.',
  itemSchema: { type: 'object' },
  tools: [] as string[],
  modules: [],
  context: [],
};
const inputData = { generalReport: 'Research complete.', groupings: [grouping] };
const execute = (generate: ReturnType<typeof vi.fn>, groups = [grouping]) =>
  (writeCodeStep.execute as any)({
    inputData: { ...inputData, groupings: groups },
    mastra: { getAgentById: () => ({ generate }), listTools: () => ({}) },
  });

it('writes and compiles code in a single step without tools', async () => {
  const generate = vi.fn().mockResolvedValue({ text: code });
  expect(await execute(generate)).toEqual([{ groupingName: 'jobs', code }]);
  expect(generate).toHaveBeenCalledWith(
    expect.stringContaining('Return JavaScript now without calling tools'),
    { maxSteps: 1, toolChoice: 'none' }
  );
});

it('retries blank and invalid code only for the failed group', async () => {
  let attempts = 0;
  const generate = vi.fn(async (prompt: string) => {
    if (prompt.includes('https://other.test/jobs')) {
      attempts++;
      if (attempts === 1) {
        return { text: '' };
      }
      if (attempts === 2) {
        return { text: 'invalid JavaScript !' };
      }
    }
    return { text: code };
  });
  expect(
    await execute(generate, [
      grouping,
      { ...grouping, groupingName: 'other', urls: ['https://other.test/jobs'] },
    ])
  ).toHaveLength(2);
  expect(generate).toHaveBeenCalledTimes(4);
  expect(generate.mock.calls[3][0]).toContain('Previous attempt failed');
});

it('keeps the successful group and emits a throwing placeholder after three failures', async () => {
  const generate = vi.fn(async (prompt: string) => {
    if (prompt.includes('https://other.test/jobs')) {
      throw new Error('Provider failed');
    }
    return { text: code };
  });
  const results = await execute(generate, [
    grouping,
    {
      ...grouping,
      groupingName: 'other',
      urls: ['https://other.test/jobs'],
    },
  ]);
  expect(results[0]).toEqual({ groupingName: 'jobs', code });
  expect(generate).toHaveBeenCalledTimes(4);
  const bot = new Bot(await new Compiler().compile(results[1].code));
  expect(await bot.check('https://other.test/jobs')).toBe(true);
  expect(await bot.check('https://example.test/jobs')).toBe(false);
  await expect(bot.run('https://other.test/jobs')).rejects.toThrow('Provider failed');
});

it('isolates a group that requests an unavailable capability', async () => {
  const generate = vi.fn().mockResolvedValue({ text: code });
  const results = await execute(generate, [
    grouping,
    {
      ...grouping,
      groupingName: 'broken',
      tools: ['missingTool'],
    },
  ]);
  expect(results[0].code).toBe(code);
  const bot = new Bot(await new Compiler().compile(results[1].code));
  await expect(bot.run(grouping.urls[0])).rejects.toThrow('Requested tool is not available');
  expect(generate).toHaveBeenCalledOnce();
});

const planObject = {
  generalReport: 'Collected evidence',
  groupings: [{ ...grouping, itemSchema: null }],
};
const plan = (generate: ReturnType<typeof vi.fn>) =>
  (planStep.execute as any)({
    inputData: { ...grouping, itemSchema: grouping.itemSchema },
    mastra: { getAgentById: () => ({ generate }) },
  });

it('finalizes exhausted planning from collected evidence without tools', async () => {
  const messages = [{ role: 'assistant', content: 'Verified endpoint.' }];
  const generate = vi
    .fn()
    .mockResolvedValueOnce({ object: undefined, steps: Array(20).fill({}), messages })
    .mockResolvedValueOnce({ object: planObject });
  expect((await plan(generate)).groupings[0].itemSchema).toEqual(grouping.itemSchema);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1][0]).toEqual([
    ...messages,
    expect.objectContaining({ role: 'user' }),
  ]);
  expect(generate.mock.calls[1][1]).toMatchObject({ maxSteps: 1, toolChoice: 'none' });
});

it.each([
  { error: new Error('Provider error') },
  { tripwire: { reason: 'Blocked' } },
  { steps: [] },
])('does not finalize non-budget planning failures', async (failure) => {
  const generate = vi
    .fn()
    .mockResolvedValue({ object: undefined, steps: Array(20).fill({}), ...failure });
  await expect(plan(generate)).rejects.toThrow('Planner did not return a structured report');
  expect(generate).toHaveBeenCalledOnce();
});
