import { Bot } from '../bot/Bot.js';
import { type CompileOptions, Compiler } from './Compiler.js';
import { toContextTools } from './tool-fns.js';
import { allTools } from '../mastra/tools/index.js';

export const toBot = async (code: string): Promise<Bot> => {
  const compiler = new Compiler();
  return new Bot(
    await compiler.compile(code, { additionalContext: { tools: toContextTools(allTools) } })
  );
};
