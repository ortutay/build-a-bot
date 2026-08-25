import { Bot } from '../bot/Bot.js';
import { type CompileOptions, Compiler } from './Compiler.js';

export const toBot = async (
  code: string,
  { additionalContext = {} }: CompileOptions = {}
): Promise<Bot> => {
  const compiler = new Compiler();
  return new Bot(await compiler.compile(code, additionalContext));
};
