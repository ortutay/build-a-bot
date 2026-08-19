import { type Tool } from '@mastra/core/tools';
import { BrowserToolCache } from './BrowserToolCache.js';

const cache = new BrowserToolCache();

export const browserCacheInstrument =
  (replay: any) =>
  async (tool: Tool): Promise<Tool> => {
    const execute = tool.execute;
    if (!execute) {
      return tool;
    }

    return {
      ...tool,
      execute: async (input, context) => {
        console.log('instrument TOOL:', tool);
        console.log('instrument CONTEXT:', context);

        const pageId: string | null =
          input && typeof input == 'object' && 'pageId' in input && typeof input.pageId === 'string'
            ? input.pageId
            : null;

        let cached;
        if (pageId) {
          console.log('Checking tool call for:', pageId, tool.id);
          const r = await cache.checkToolCall(pageId, tool.id, input as Record<string, any>);
          if (r.steps.length > 0) {
            console.log('Instrument got replay steps:', r.steps);
            await replay(pageId, r.steps, context);
          } else {
            console.log('Instrument got cached browser data:', cached);
            cached = r.cached;
          }
        }

        console.log('Execute browser tool:', pageId);
        const output = cached ?? (await execute(input, context));

        if (pageId) {
          await cache.recordToolCall(pageId, tool.id, input as Record<string, any>, output);
        }

        return output;
      },
    };
  };
