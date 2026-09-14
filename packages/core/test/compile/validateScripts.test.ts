import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Bot } from '../../src/bot/Bot.js';
import type { Script } from '../../src/compile/Script.js';
import { SeedValidationError, validateScripts } from '../../src/compile/validateScripts.js';

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
  const compile = vi.fn(async () => bot);
  return { script: { compile } as unknown as Script, compile, check, run };
};

it('validates each seed with a single URL and accepts empty arrays', async () => {
  const { script, check, run } = candidate({
    run: (url) => (url === urls[0] ? [] : [{ id: url }]),
  });
  await expect(validateScripts([script], urls, schema)).resolves.toEqual(
    new Map(urls.map((url) => [url, script]))
  );
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

it('accepts failures once per script without repeating compilation, checks or runs', async () => {
  const bad = candidate({
    run: () => {
      throw new Error('Still unavailable');
    },
  });
  const other = 'https://other.test/c';
  const good = candidate({ check: (url) => url === other });
  bad.check.mockImplementation(async (url) => ({ out: url !== other, logs: [] }));
  const seeds = [...urls, other];
  const acceptFailure = vi.fn(() => true);
  await expect(
    validateScripts([bad.script, good.script], seeds, schema, acceptFailure)
  ).resolves.toEqual(
    new Map([
      [urls[0], bad.script],
      [urls[1], bad.script],
      [other, good.script],
    ])
  );
  expect(acceptFailure).toHaveBeenCalledOnce();
  expect(acceptFailure.mock.calls[0]).toEqual([
    expect.objectContaining({ url: urls[0], script: bad.script, urls }),
  ]);
  for (const val of [bad, good]) {
    expect(val.compile).toHaveBeenCalledOnce();
    expect(val.check).toHaveBeenCalledTimes(3);
  }
  expect(bad.run.mock.calls).toEqual(urls.map((url) => [url]));
  expect(good.run.mock.calls).toEqual([[other]]);
});

it('still rejects an unaccepted failure from another script', async () => {
  const first = candidate({
    check: (url) => url === urls[0],
    run: () => {
      throw new Error('First');
    },
  });
  const second = candidate({
    check: (url) => url === urls[1],
    run: () => {
      throw new Error('Second');
    },
  });
  const acceptFailure = vi.fn((e: SeedValidationError) => e.script === first.script);
  await expect(
    validateScripts([first.script, second.script], urls, schema, acceptFailure)
  ).rejects.toMatchObject({
    script: second.script,
    url: urls[1],
    urls: [urls[1]],
  });
  expect(acceptFailure).toHaveBeenCalledTimes(2);
});

it('never bypasses routing failures through the acceptance callback', async () => {
  const acceptFailure = vi.fn(() => true);
  const { script } = candidate();
  await expect(validateScripts([script, script], urls, schema, acceptFailure)).rejects.toThrow(
    'matched 2 scripts'
  );
  expect(acceptFailure).not.toHaveBeenCalled();
});
