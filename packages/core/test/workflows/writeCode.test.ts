import { expect, it, vi } from 'vitest';
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
  tools: [],
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

it('stops after three failed attempts without producing a placeholder script', async () => {
  const generate = vi.fn().mockRejectedValue(new Error('Provider failed'));
  await expect(execute(generate)).rejects.toThrow(
    'Script generation failed for jobs: Provider failed'
  );
  expect(generate).toHaveBeenCalledTimes(3);
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
