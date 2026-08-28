import { type Mastra } from '@mastra/core';
import { Bot } from '../bot/Bot.js';
import { Compiler } from './Compiler.js';
import { toContextTools } from './tool-fns.js';

export const toBot = async (code: string, mastra: Mastra): Promise<Bot> => {
  const compiler = new Compiler();
  const tools = mastra.listTools() ?? {};
  return new Bot(
    await compiler.compile(code, { additionalContext: { tools: toContextTools(tools) } })
  );
};
