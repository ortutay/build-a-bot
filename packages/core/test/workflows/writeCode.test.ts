import { expect, it, vi } from 'vitest';
import { Bot } from '../../src/bot/Bot.js';
import { Compiler } from '../../src/compile/Compiler.js';
import { planOutputSchema } from '../../src/mastra/workflows/schemas.js';
import { planStep, writeCodeStep } from '../../src/mastra/workflows/steps.js';

type Generate = (prompt: string, options: Record<string, unknown>) => Promise<{ text: string }>;

const code = `export const itemSchema = { type: 'object' };
export const uniqueId = item => item.id;
export const check = async url => true;
export const run = async url => [];`;
const grouping = {
  groupingName: 'jobs',
  groupingDescription: 'Jobs from the verified endpoint.',
  urls: ['https://example.test/jobs'],
};
const inputData = planOutputSchema.parse({
  goal: 'Extract jobs',
  itemSchema: { type: 'object' },
  report: 'Research complete.',
  tools: [],
  modules: [],
  context: [],
  groupings: [grouping],
});
const execute = (generate: Generate, groups = [grouping]) =>
  (writeCodeStep.execute as any)({
    inputData: { ...inputData, groupings: groups },
    mastra: {
      getAgentById: () => ({ generate }),
      listTools: () => ({}),
    },
  });

it('writes and compiles code in a single step without tools', async () => {
  const generate = vi.fn().mockResolvedValue({ text: code });
  expect(await execute(generate)).toEqual([{ groupingName: 'jobs', code }]);
  expect(generate.mock.calls[0][0]).toContain(inputData.report);
  expect(generate.mock.calls[0][0]).toContain(grouping.groupingDescription);
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

it.each([
  ['tools', 'tool'],
  ['modules', 'module'],
  ['context', 'context'],
])('rejects unavailable shared %s before generating any code', async (field, type) => {
  const generate = vi.fn().mockResolvedValue({ text: code });
  await expect(
    (writeCodeStep.execute as any)({
      inputData: { ...inputData, [field]: ['missing'] },
      mastra: { getAgentById: () => ({ generate }), listTools: () => ({}) },
    })
  ).rejects.toThrow(`Requested ${type} is not available: missing`);
  expect(generate).not.toHaveBeenCalled();
});

const planObject = inputData;
const plan = (generate: ReturnType<typeof vi.fn>) =>
  (planStep.execute as any)({
    inputData: { ...inputData, urls: grouping.urls },
    mastra: { getAgentById: () => ({ generate }) },
  });

it('finalizes exhausted planning from collected evidence without tools', async () => {
  const messages = [{ role: 'assistant', content: 'Verified endpoint.' }];
  const generate = vi
    .fn()
    .mockResolvedValueOnce({ object: undefined, steps: Array(20).fill({}), messages })
    .mockResolvedValueOnce({ object: planObject });
  expect((await plan(generate)).itemSchema).toEqual(inputData.itemSchema);
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

it('preserves the provider error as the planning failure cause', async () => {
  const e = new Error('Provider error');
  const generate = vi.fn().mockResolvedValue({ object: undefined, error: e });
  await expect(plan(generate)).rejects.toMatchObject({
    message: 'Planner did not return a structured report',
    cause: e,
  });
});

it('reports a failed finalization without another generation attempt', async () => {
  const generate = vi.fn().mockResolvedValue({
    object: undefined,
    steps: Array(20).fill({}),
    messages: [],
  });
  await expect(plan(generate)).rejects.toThrow('Planner did not return a structured report');
  expect(generate).toHaveBeenCalledTimes(2);
});
