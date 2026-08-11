import * as run from './core/run.js';
import { compile } from './core/compile.js';

export const execute = async ({ code, input }) => {
  const { fn } = await compile(code);
  return fn(input);
};

export const build = async ({ url, prompt, modules }) => {
  const { content: code, usage } = await run.runFull({ url, prompt });
  const { fn, inputSchema, outputSchema } = await compile(code);
  return { fn, code, inputSchema, outputSchema, usage };
};
