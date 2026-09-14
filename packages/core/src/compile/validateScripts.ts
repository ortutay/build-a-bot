import { z } from 'zod';
import type { Script } from './Script.js';

export class SeedValidationError extends Error {
  constructor(
    readonly url: string,
    readonly script: Script,
    readonly urls: string[],
    e: unknown
  ) {
    super(`Seed validation failed for ${url}: ${String(e)}`, { cause: e });
  }
}

// Validate candidates before activation, without writing runs or extracted items.
export const validateScripts = async (
  scripts: Script[],
  urls: string[],
  itemSchema: z.ZodType,
  acceptFailure: (e: SeedValidationError) => boolean = () => false
): Promise<Map<string, Script>> => {
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
    const bot = matches[0]!;
    return { url, bot, script: scripts[bots.indexOf(bot)]! };
  });
  const outcomes = await Promise.allSettled(
    routes.map(async ({ url, bot, script }) => {
      try {
        const items = await z.array(itemSchema).parseAsync(await bot.run(url));
        for (const item of items) {
          const id = bot.uniqueId(item);
          if (typeof id !== 'string' || !id || id !== bot.uniqueId(item)) {
            throw new Error('uniqueId() must return a stable nonempty string');
          }
        }
      } catch (e) {
        throw new SeedValidationError(
          url,
          script,
          routes.filter((val) => val.script === script).map((val) => val.url),
          e
        );
      }
    })
  );
  // Decide once per script, in seed order, without repeating compilation or execution.
  const accepted = new Set<Script>();
  for (const val of outcomes) {
    if (val.status === 'rejected') {
      const e = val.reason;
      if (!(e instanceof SeedValidationError)) {
        throw e;
      }
      if (accepted.has(e.script)) {
        continue;
      }
      if (!acceptFailure(e)) {
        throw e;
      }
      accepted.add(e.script);
    }
  }
  return new Map(routes.map(({ url, script }) => [url, script]));
};
