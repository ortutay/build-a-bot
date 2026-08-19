import { type Tool } from '@mastra/core/tools';

export * from './runtime.js';
export * from './cacheInstrument.js';
export * from './concurrency.js';
export * from './brightdata.js';
export * from './firecrawl.js';
export * from './scrapingbee.js';

export type Instrument = (tool: Tool) => Promise<Tool>;

type AnyTool = Tool<any, any, any, any, any, any, any>;

export const addInstruments = async (
  instruments: Instrument[],
  tool: AnyTool
): Promise<AnyTool> => {
  let instrumented = tool;
  for (const instrument of instruments) {
    instrumented = await instrument(tool);
  }
  return instrumented;
};
