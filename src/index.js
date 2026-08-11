import * as run from './core/run';
import { compile } from './core/compile';

export const build = async ({ url, prompt }) => {
  const { content: code, usage } = await run.runFull({ url, prompt });
  const fn = await compile(code);
  return { fn, code, usage };
};
