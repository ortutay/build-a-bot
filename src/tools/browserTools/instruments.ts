import { type Tool } from '@mastra/core/tools';
import { BrowserToolCache } from './BrowserToolCache.js';

const cache = new BrowserToolCache();
const instrumented: Record<string, Tool> = {};

export const browserCacheInstrument = async (tool: Tool): Promise<Tool> => {
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }

  instrumented[tool.id] = tool;
  tool.execute = async (input, context) => {
    const pageId: string | null =
      input && typeof input == 'object' && 'pageId' in input && typeof input.pageId === 'string'
        ? input.pageId
        : null;

    if (pageId) {
      console.log('Checking tool call for:', pageId, tool.id);
      const cached = await cache.checkToolCall(pageId, tool.id, input as Record<string, any>);
      console.log('Instrument got cached browser data:', cached);
    }

    console.log('TODO: browserCacheInstrument:', input, tool, context);
    const output = await execute(input, context);

    if (pageId) {
      await cache.recordToolCall(pageId, tool.id, input as Record<string, any>, output);
    }

    return output;
  };

  return tool;
};
