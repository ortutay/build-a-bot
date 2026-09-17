import { type Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { scrapingbeeApiKey } from '../../../constants.js';
import type { GlobalContext } from '../../../context/index.js';
import { addInstruments } from '../../instruments/index.js';
import { scrapingbeeCostInstrument } from './instruments.js';

export const close = async (_context: GlobalContext): Promise<void> => {};

export const createTools = async (): Promise<Record<string, Tool>> => {
  const mcpClient = new MCPClient({
    id: 'scrapingbee-mcp-client',
    servers: {
      scrapingbee: {
        url: new URL(`https://mcp.scrapingbee.com/mcp?api_key=${scrapingbeeApiKey}`),
      },
    },
  });

  const mcpTools = (await mcpClient.listToolsets()).scrapingbee ?? {};
  return Object.fromEntries(
    await Promise.all(
      Object.entries(mcpTools).map(async ([name, tool]) => [
        name,
        await addInstruments([scrapingbeeCostInstrument], tool),
      ])
    )
  );
};
