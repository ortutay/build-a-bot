import { type Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { addInstruments } from '../../mastra/instruments/index.js';
import { scrapingbeeApiKey } from '../../constants.js';
import { scrapingbeeCostInstrument } from './instruments.js';

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
