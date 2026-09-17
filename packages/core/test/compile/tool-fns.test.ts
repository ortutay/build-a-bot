import { expect, it, vi } from 'vitest';
import { toContextTools } from '../../src/compile/tool-fns.js';

it.each([{ error: true }, { isError: true }])('throws returned tool failures: %j', async (flag) => {
  const tools = toContextTools({
    fetch: { execute: async () => ({ ...flag, message: 'Invalid input' }) },
  });
  await expect(tools.fetch({})).rejects.toThrow('Invalid input');
});

it('preserves normal results and thrown exceptions', async () => {
  const result = { error: 'an ordinary data field', isError: false };
  const execute = vi.fn(async () => result);
  const tools = toContextTools({ fetch: { execute } });
  await expect(tools.fetch({ url: 'https://example.test' })).resolves.toBe(result);
  const e = new Error('transport failure');
  execute.mockRejectedValueOnce(e);
  await expect(tools.fetch({})).rejects.toBe(e);
});
