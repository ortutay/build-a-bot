import { Bot } from './bot/Bot.js';
import { Workshop } from './workshop/Workshop.js';
import type { BuildOptions } from './types.js';

export { Workshop } from './workshop/Workshop.js';

export const build = async (options: BuildOptions): Promise<Bot | undefined> => {
  // return;
  const ws = new Workshop();
  return ws.build(options);
};

// import * as run from './core/run.js';
// import { compile } from './core/compile.js';

// export const execute = async ({ code, input }) => {
//   const { fn } = await compile(code);
//   return fn(input);
// };

// export const build = async ({ url, prompt, modules }) => {
//   const { content: code, usage } = await run.runFull({ url, prompt });
//   const { fn, inputSchema, outputSchema } = await compile(code);
//   return { fn, code, inputSchema, outputSchema, usage };
// };
