import { omit } from 'radash';
import { type DiskCache } from '../../../cache/DiskCache.js';
import { cb } from '../../../cache/busters.js';
import { log } from '../../../logger.js';
import { hash } from '../../../util/index.js';

type CacheBackend = Pick<DiskCache, 'get' | 'set'>;

export class BrowserToolCache {
  cache: CacheBackend;
  sequences: Record<string, { toolId: string; input: any; output: any }[]>;

  constructor(cache: CacheBackend) {
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
    input = omit(input, ['cursorId']);
    const inputs = sequence.map((it) => ({
      toolId: it.toolId,
      input: it.input,
    }));
    inputs.push({ toolId, input });
    const key = hash({ cacheBuster: cb.browserToolCache, inputs });

    const cached = await this.cache.get(key);
    const keyDigest = key.slice(0, 12);

    if (cached !== null && cached !== undefined) {
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
    output: unknown
  ) {
    this.sequences[cursorId] ||= [];
    const sequence = this.sequences[cursorId];
    sequence.push({
      toolId,
      input: omit(input, ['cursorId']),
      output,
    });

    const inputs = sequence.map((it) => ({
      toolId: it.toolId,
      input: it.input,
    }));
    const key = hash({ cacheBuster: cb.browserToolCache, inputs });
    const cached = sequence.at(-1)?.output;

    log.debug(
      `Browser cache set: tool=${toolId}, key=${key.slice(0, 12)}, prefixLength=${sequence.length}`
    );

    await this.cache.set(key, cached);
  }
}
