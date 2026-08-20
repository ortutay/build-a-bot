import { type Tool } from '@mastra/core/tools';
import { KeyedSerialQueue } from '../../util/KeyedSerialQueue.js';
import { getOrNull } from '../../util/index.js';
import { BrowserToolCache } from './BrowserToolCache.js';

export const browserCacheInstrument = (replay: any, cache: BrowserToolCache) => {
  const cursorQueue = new KeyedSerialQueue<string>();
  const cursorStatus: Record<string, string> = {};

  return async (tool: Tool): Promise<Tool> => {
    const execute = tool.execute;
    if (!execute) {
      return tool;
    }

    return {
      ...tool,
      execute: async (input, context) => {
        const cursorId = getOrNull<string>(input, 'cursorId');

        const run = async () => {
          if (cursorId) {
            cursorStatus[cursorId] ||= 'cached';
          }

          let hit = false;
          let cached;
          if (cursorId && cursorStatus[cursorId] == 'cached') {
            const r = await cache.checkToolCall(cursorId, tool.id, input as Record<string, any>);

            if (r.hit) {
              hit = true;
              cached = r.cached;
            } else {
              cursorStatus[cursorId] = 'live';
            }

            if (r.steps.length > 0) {
              try {
                await replay(cursorId, r.steps);
              } catch (e) {
                // We did not restore the cursor to live state. Try again next time.
                cursorStatus[cursorId] = 'cached';
                throw e;
              }
            }
          }

          const output = hit ? cached : await execute(input, context);
          // Only cache successful executions and completed cache hits.
          if (cursorId) {
            await cache.recordToolCall(cursorId, tool.id, input as Record<string, any>, output);
          }

          return output;
        };

        return cursorId ? cursorQueue.add(cursorId, run) : run();
      },
    };
  };
};
