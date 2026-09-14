import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Bot } from '../../src/bot/Bot.js';
import type { Script } from '../../src/compile/Script.js';
import { validateScripts } from '../../src/compile/validateScripts.js';

const urls = ['https://example.test/a', 'https://example.test/b'];
const schema = z.object({ id: z.string() });
const candidate = (
  options: {
    check?: (url: string) => unknown;
    run?: (url: string) => unknown;
    uniqueId?: (item: unknown) => string;
  } = {}
) => {
  const check = vi.fn(async (url: string) => ({ out: options.check?.(url) ?? true, logs: [] }));
  const run = vi.fn(async (url: string) => ({
    out: options.run ? await options.run(url) : [{ id: url }],
    logs: [],
  }));
  const bot = new Bot({
    check,
    run,
    itemSchema: {},
    uniqueId: options.uniqueId ?? ((item) => (item as { id: string }).id),
  });
  return { script: { compile: async () => bot } as unknown as Script, check, run };
};

it('validates each seed with a single URL and accepts empty arrays', async () => {
  const { script, check, run } = candidate({
    run: (url) => (url === urls[0] ? [] : [{ id: url }]),
  });
  await expect(validateScripts([script], urls, schema)).resolves.toBeUndefined();
  expect(check.mock.calls).toEqual(urls.map((url) => [url]));
  expect(run.mock.calls).toEqual(urls.map((url) => [url]));
});

it.each([0, 2])('rejects %i matching scripts before executing any seed', async (count) => {
  const { script, run } = candidate();
  await expect(validateScripts(Array(count).fill(script), urls, schema)).rejects.toThrow(
    `matched ${count} scripts`
  );
  expect(run).not.toHaveBeenCalled();
});

it.each([
  { run: () => [{ id: 42 }] },
  { run: () => null },
  {
    run: () => {
      throw new Error('Unavailable');
    },
  },
  { uniqueId: () => '' },
])('rejects invalid execution or identity', async (options) => {
  await expect(validateScripts([candidate(options).script], urls, schema)).rejects.toThrow(
    'Seed validation failed'
  );
});

it('rejects an identity that changes for the same item', async () => {
  let count = 0;
  const { script } = candidate({ uniqueId: () => String(count++) });
  await expect(validateScripts([script], urls, schema)).rejects.toThrow('stable nonempty string');
});

it('rejects check failures', async () => {
  const { script, run } = candidate({
    check: () => {
      throw new Error('Check failed');
    },
  });
  await expect(validateScripts([script], urls, schema)).rejects.toThrow('Check failed');
  expect(run).not.toHaveBeenCalled();
});
