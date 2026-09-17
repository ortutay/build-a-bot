import { omit } from 'radash';
import { type DiskCache } from '../../../cache/DiskCache.js';
import { cb } from '../../../cache/busters.js';
import { toolCacheInput } from '../../../cache/toolCacheKey.js';
import { log } from '../../../logger.js';
import { getOrNull, hash } from '../../../util/index.js';
import { isToolFailure } from '../../toolError.js';

type CacheBackend = Pick<DiskCache, 'get' | 'set'>;

const uncacheable = (step: { toolId: string; output: unknown }): boolean =>
  isToolFailure(step.output) ||
  getOrNull<string>(getOrNull(step.output, 'readiness'), 'state') === 'timeout';

export class BrowserToolCache {
  cache: CacheBackend;
  sequences: Record<string, { toolId: string; input: any; output: any }[]>;

  constructor(
    cache: CacheBackend,
    readonly cacheScope = ''
  ) {
    this.cache = cache;

    this.sequences = {};
  }

  async checkToolCall(
    cursorId: string,
    toolId: string,
    input: Record<string, any>
  ): Promise<{ cached: any; hit: boolean; steps: any[] }> {
    const sequence = this.sequences[cursorId] || [];

    // TODO: pull out helper for this part, use it in recordToolCall
    const inputs = sequence.map((it) => ({
      toolId: it.toolId,
      input: it.input,
    }));
    inputs.push({ toolId, input: toolCacheInput(omit(input, ['cursorId'])) });
    const key = hash({ cacheBuster: cb.browserToolCache, cacheScope: this.cacheScope, inputs });

    const cached = sequence.some(uncacheable) ? undefined : await this.cache.get(key);
    const keyDigest = key.slice(0, 12);

    if (cached !== undefined) {
      log.info(
        `Browser cache hit: tool=${toolId}, key=${keyDigest}, prefixLength=${sequence.length}`
      );
      return { cached, hit: true, steps: [] };
    } else {
      log.info(
        `Browser cache miss: tool=${toolId}, key=${keyDigest}, prefixLength=${sequence.length}`
      );
      inputs.pop();
      return { cached: null, hit: false, steps: inputs };
    }
  }

  async recordToolCall(
    cursorId: string,
    toolId: string,
    input: Record<string, any>,
    output: unknown,
    write = true
  ) {
    this.sequences[cursorId] ||= [];
    const sequence = this.sequences[cursorId];
    sequence.push({
      toolId,
      input: toolCacheInput(omit(input, ['cursorId'])),
      output,
    });

    // Keep the interaction history, but never cache results from a failed prefix.
    if (!write || sequence.some(uncacheable)) {
      return;
    }

    const inputs = sequence.map((it) => ({
      toolId: it.toolId,
      input: it.input,
    }));
    const key = hash({ cacheBuster: cb.browserToolCache, cacheScope: this.cacheScope, inputs });
    const cached = sequence.at(-1)?.output;

    log.debug(
      `Browser cache set: tool=${toolId}, key=${key.slice(0, 12)}, prefixLength=${sequence.length}`
    );

    await this.cache.set(key, cached);
  }
}
