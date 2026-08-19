import { type Tool } from '@mastra/core/tools';
import { addInstruments } from '../../instruments/index.js';
import { scrapingbeeCostInstrument } from './instruments.js';

export const createScrapingbeeTools = async (
  mcpTools: Record<string, Tool>
): Promise<Record<string, Tool>> => {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(mcpTools).map(async ([name, tool]) => [
        name,
        await addInstruments([scrapingbeeCostInstrument], tool),
      ])
    )
  );
};
