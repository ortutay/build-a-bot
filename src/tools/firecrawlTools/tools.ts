import { type Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { addInstruments } from '../../mastra/instruments/index.js';
import { firecrawlApiKey } from '../../constants.js';
import { firecrawlCostInstrument } from './instruments.js';

export const createTools = async (): Promise<Record<string, Tool>> => {
  const mcpClient = new MCPClient({
    id: 'firecrawl-mcp-client',
    servers: {
      firecrawl: {
        url: new URL(`https://mcp.firecrawl.dev/${firecrawlApiKey}/v2/mcp`),
      },
    },
  });

  const mcpTools = (await mcpClient.listToolsets()).firecrawl ?? {};
  return Object.fromEntries(
    await Promise.all(
      Object.entries(mcpTools).map(async ([name, tool]) => [
        name,
        await addInstruments([firecrawlCostInstrument], tool),
      ])
    )
  );
};
