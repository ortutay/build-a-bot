import { type Tool } from '@mastra/core/tools';
import { KeyedSerialQueue } from '../../util/KeyedSerialQueue.js';
import { getOrNull } from '../../util/index.js';
import { BrowserToolCache } from './BrowserToolCache.js';

export const browserCacheInstrument = (replay: any, cache: BrowserToolCache) => {
  const pageQueue = new KeyedSerialQueue<string>();
  const pageStatus: Record<string, string> = {};

  return async (tool: Tool): Promise<Tool> => {
    const execute = tool.execute;
    if (!execute) {
      return tool;
    }

    return {
      ...tool,
      execute: async (input, context) => {
        const pageId = getOrNull<string>(input, 'pageId');

        const run = async () => {
          if (pageId) {
            pageStatus[pageId] ||= 'cached';
          }

          let hit = false;
          let cached;
          if (pageId && pageStatus[pageId] == 'cached') {
            const r = await cache.checkToolCall(pageId, tool.id, input as Record<string, any>);

            if (r.hit) {
              hit = true;
              cached = r.cached;
            } else {
              pageStatus[pageId] = 'live';
            }

            if (r.steps.length > 0) {
              try {
                await replay(pageId, r.steps);
              } catch (e) {
                // We did not restore page the live. Try again next time.
                pageStatus[pageId] = 'cached';
                throw e;
              }
            }
          }

          const output = hit ? cached : await execute(input, context);
          // Only cache successful executions and completed cache hits.
          if (pageId) {
            await cache.recordToolCall(pageId, tool.id, input as Record<string, any>, output);
          }

          return output;
        };

        return pageId ? pageQueue.add(pageId, run) : run();
      },
    };
  };
};
