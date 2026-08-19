import { type Tool } from '@mastra/core/tools';
import { addInstruments } from '../../instruments/index.js';
import { brightdataCostInstrument } from './instruments.js';

export const createBrightdataTools = async (
  mcpTools: Record<string, Tool>
): Promise<Record<string, Tool>> => {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(mcpTools).map(async ([name, tool]) => [
        name,
        await addInstruments([brightdataCostInstrument], tool),
      ])
    )
  );
};
