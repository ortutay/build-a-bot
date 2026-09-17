import { Mastra } from '@mastra/core/mastra';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Compiler } from '../../src/compile/Compiler.js';
import { healWorkflow } from '../../src/mastra/workflows/index.js';
import {
  healAgentOutputSchema,
  healInputSchema,
  healOutputSchema,
} from '../../src/mastra/workflows/schemas.js';

type HealAgentOutput = z.infer<typeof healAgentOutputSchema>;

const url = 'https://example.test/items';
const codeFor = (id: string) => `export const itemSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
};
export const uniqueId = item => item.id;
export const check = async url => true;
export const run = async url => [{ id: '${id}' }];`;
const invalidCode = `export const itemSchema = { type: 'object' };
export const uniqueId = item => item.id;
export const check = async url => true;
export const run = async url => [`;
const correctCode = codeFor('correct');

const runHeal = async (
  code: string,
  outputs: HealAgentOutput[],
  dependencies: Partial<Pick<z.infer<typeof healInputSchema>, 'context' | 'modules' | 'tools'>> = {}
) => {
  const generate = vi.fn().mockImplementation(async () => {
    const output = outputs.shift();
    if (!output) {
      throw new Error('Unexpected heal attempt');
    }
    return { object: output };
  });
  const mastra = new Mastra({ workflows: { healWorkflow }, logger: false });
  const agent = vi.spyOn(mastra, 'getAgentById').mockReturnValue({ generate } as any);

  try {
    const run = await mastra.getWorkflowById('heal-workflow').createRun();
    const result = await run.start({
      inputData: {
        code,
        context: [],
        goal: 'Extract items',
        itemSchema: { type: 'object' },
        modules: [],
        tools: [],
        urls: [url],
        ...dependencies,
      },
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error(`Workflow failed: ${result.status}`);
    }
    return { generate, output: healOutputSchema.parse(result.result) };
  } finally {
    agent.mockRestore();
  }
};

const noChanges = (report: string): HealAgentOutput => ({
  code: null,
  noChanges: true,
  rating: 100,
  report,
});

const changed = (code: string, report: string): HealAgentOutput => ({
  code,
  noChanges: false,
  rating: 70,
  report,
});

it('returns null code when no healing takes place', async () => {
  const { generate, output } = await runHeal(correctCode, [noChanges('The script is correct.')]);

  expect(output).toEqual({
    code: null,
    context: [],
    modules: [],
    noChanges: true,
    rating: 100,
    report: 'The script is correct.',
    shouldSave: false,
    tools: [],
  });
  expect(generate).toHaveBeenCalledOnce();
  expect(generate.mock.calls[0][1]).toEqual(
    expect.objectContaining({
      toolsets: {
        bot: expect.objectContaining({
          bot_check: expect.objectContaining({ id: 'bot_check' }),
          bot_logs: expect.objectContaining({ id: 'bot_logs' }),
          bot_run: expect.objectContaining({ id: 'bot_run' }),
        }),
      },
    })
  );
});

it.each(['context', 'modules', 'tools'] as const)(
  'requests a save when only an unavailable %s dependency is removed',
  async (field) => {
    const { output } = await runHeal(correctCode, [noChanges('The script is correct.')], {
      [field]: ['missing'],
    });

    expect(output).toMatchObject({ code: null, noChanges: true, shouldSave: true });
    expect(output[field]).toEqual([]);
  }
);

it('heals once when a compiling script returns wrong results', async () => {
  const wrongCode = codeFor('wrong');
  const original = await new Compiler().compileBot(wrongCode);
  await expect(original.run(url)).resolves.toEqual([{ id: 'wrong' }]);

  const { generate, output } = await runHeal(wrongCode, [
    changed(correctCode, 'The result is wrong.'),
    noChanges('The repaired script is correct.'),
  ]);

  expect(output.code).toBe(correctCode);
  expect(output.shouldSave).toBe(true);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[0][1].toolsets).toHaveProperty('bot');
  const healed = await new Compiler().compileBot(output.code!);
  await expect(healed.run(url)).resolves.toEqual([{ id: 'correct' }]);
});

it('heals once when the script does not compile', async () => {
  const { generate, output } = await runHeal(invalidCode, [
    changed(correctCode, 'The script has invalid syntax.'),
    noChanges('The repaired script compiles.'),
  ]);

  expect(output.code).toBe(correctCode);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[0][1].toolsets).toEqual({});
  expect(generate.mock.calls[0][0]).toContain('code compilation error');
  expect(generate.mock.calls[1][1].toolsets).toHaveProperty('bot');
});

it('supports a two-step heal', async () => {
  const intermediateCode = codeFor('almost');
  const { generate, output } = await runHeal(invalidCode, [
    changed(intermediateCode, 'Fix the syntax first.'),
    changed(correctCode, 'Fix the extracted value.'),
    noChanges('The second repair is correct.'),
  ]);

  expect(output.code).toBe(correctCode);
  expect(generate).toHaveBeenCalledTimes(3);
  expect(generate.mock.calls[0][1].toolsets).toEqual({});
  expect(generate.mock.calls[1][1].toolsets).toHaveProperty('bot');
  expect(generate.mock.calls[2][1].toolsets).toHaveProperty('bot');
  expect(generate.mock.calls[1][0]).toContain(intermediateCode);
  expect(generate.mock.calls[2][0]).toContain(correctCode);
});
