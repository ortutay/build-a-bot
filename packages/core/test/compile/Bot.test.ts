import { describe, expect, it } from 'vitest';
import { Bot } from '../../src/bot/Bot.js';
import { Compiler } from '../../src/compile/Compiler.js';

const a = 'https://example.test/a';
const b = 'https://example.test/b';

describe('single-URL Bot contract', () => {
  it('passes one URL to each function and keeps concurrent run logs separate', async () => {
    const bot = new Bot(
      await new Compiler().compile(`
      export const itemSchema = { type: 'object' };
      export const uniqueId = item => item.url;
      export const check = async url => url.endsWith('/a');
      export const run = async url => {
        console.info(url);
        return [{ url }];
      };
    `)
    );
    expect(await Promise.all([bot.check(a), bot.check(b)])).toEqual([true, false]);
    expect(await Promise.all([bot.run(a, 'a'), bot.run(b, 'b')])).toEqual([
      [{ url: a }],
      [{ url: b }],
    ]);
    expect(bot.getLogs('a')).toEqual([{ level: 'info', args: [a] }]);
    expect(bot.getLogs('b')).toEqual([{ level: 'info', args: [b] }]);
  });

  it('lets exceptions escape to DataService', async () => {
    const bot = new Bot(
      await new Compiler().compile(`
      export const itemSchema = { type: 'object' };
      export const uniqueId = () => 'id';
      export const check = async url => { throw new TypeError('Check failed'); };
      export const run = async url => { throw new Error('Run failed'); };
    `)
    );
    await expect(bot.check(a)).rejects.toThrow('Check failed');
    await expect(bot.run(a)).rejects.toThrow('Run failed');
  });

  it('rejects non-boolean checks and non-array runs', async () => {
    const bot = new Bot({
      itemSchema: { type: 'object' },
      uniqueId: () => 'id',
      check: async () => ({ out: [true], logs: [] }),
      run: async () => ({ out: null, logs: [] }),
    });
    await expect(bot.check(a)).rejects.toThrow();
    await expect(bot.run(a)).rejects.toThrow();
  });
});
