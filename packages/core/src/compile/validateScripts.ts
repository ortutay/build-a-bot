import { z } from 'zod';
import type { Script } from './Script.js';

// Validate candidates before activation, without writing runs or extracted items.
export const validateScripts = async (
  scripts: Script[],
  urls: string[],
  itemSchema: z.ZodType
): Promise<void> => {
  const bots = await Promise.all(scripts.map((script) => script.compile()));
  const checks = await Promise.all(
    bots.map((bot) => Promise.all(urls.map((url) => bot.check(url))))
  );
  const routes = urls.map((url, i) => {
    const matches = bots.filter((_, index) => checks[index]![i]);
    if (matches.length !== 1) {
      throw new Error(
        `Seed validation: ${url} matched ${matches.length} scripts, expected exactly one`
      );
    }
    return { url, bot: matches[0]! };
  });
  const outcomes = await Promise.allSettled(
    routes.map(async ({ url, bot }) => {
      try {
        const items = await z.array(itemSchema).parseAsync(await bot.run(url));
        for (const item of items) {
          const id = bot.uniqueId(item);
          if (typeof id !== 'string' || !id || id !== bot.uniqueId(item)) {
            throw new Error('uniqueId() must return a stable nonempty string');
          }
        }
      } catch (e) {
        throw new Error(`Seed validation failed for ${url}: ${String(e)}`, { cause: e });
      }
    })
  );
  for (const val of outcomes) {
    if (val.status === 'rejected') {
      throw val.reason;
    }
  }
};
