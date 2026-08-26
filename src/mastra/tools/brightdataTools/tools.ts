import { type Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { addInstruments } from '../../instruments/index.js';
import { brightdataApiKey } from '../../../constants.js';
import { brightdataCostInstrument } from './instruments.js';

export const createTools = async (): Promise<Record<string, Tool>> => {
  const mcpClient = new MCPClient({
    id: 'brightdata-mcp-client',
    servers: {
      brightdata: {
        url: new URL(`https://mcp.brightdata.com/mcp?token=${brightdataApiKey}`),
      },
    },
  });

  const mcpTools = (await mcpClient.listToolsets()).brightdata ?? {};
  return Object.fromEntries(
    await Promise.all(
      Object.entries(mcpTools).map(async ([name, tool]) => [
        name,
        await addInstruments([brightdataCostInstrument], tool),
      ])
    )
  );
};
