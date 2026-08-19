import { type Tool } from '@mastra/core/tools';
import { BrowserToolCache } from './BrowserToolCache.js';

export const browserCacheInstrument = (replay: any, cache: BrowserToolCache) => {
  const busy: Record<string, boolean> = {};
  const pageStatus: Record<string, string> = {};

  return async (tool: Tool): Promise<Tool> => {
    const execute = tool.execute;
    if (!execute) {
      return tool;
    }

    return {
      ...tool,
      execute: async (input, context) => {
        let pageId: string | null =
          input && typeof input == 'object' && 'pageId' in input && typeof input.pageId === 'string'
            ? input.pageId
            : null;

        if (pageId) {
          if (busy[pageId]) {
            throw new Error('Unexpected concurrent calls on a single pageId');
          }
          busy[pageId] = true;
          pageStatus[pageId] ||= 'cached';
        }
        try {
          let hit = false;
          let cached;
          if (pageId && pageStatus[pageId] == 'cached') {
            console.log('Checking tool call for:', pageId, tool.id);
            const r = await cache.checkToolCall(pageId, tool.id, input as Record<string, any>);

            if (r.hit) {
              hit = true;
              cached = r.cached;
              console.log('Instrument got cached browser data:', cached);
            } else {
              pageStatus[pageId] = 'live';
            }

            if (r.steps.length > 0) {
              console.log('Instrument got replay steps:', r.steps);
              try {
                await replay(pageId, r.steps, context);
              } catch (e) {
                // We did not restore page the live. Try again next time.
                pageStatus[pageId] = 'cached';
                throw e;
              }
            }
          }

          console.log('Execute browser tool:', pageId);

          const output = hit ? cached : await execute(input, context);
          // Only cache successful executions and completed cache hits.
          if (pageId) {
            await cache.recordToolCall(pageId, tool.id, input as Record<string, any>, output);
          }

          return output;
        } finally {
          if (pageId) {
            delete busy[pageId];
          }
        }
      },
    };
  };
};
