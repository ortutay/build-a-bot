import { omit } from 'radash';
import { type DiskCache } from '../../cache/DiskCache.js';
import { log } from '../../logger.js';
import { hash } from '../../util.js';

type CacheBackend = Pick<DiskCache, 'get' | 'set'>;
const cacheVersion = 1;

export class BrowserToolCache {
  cache: CacheBackend;
  sequences: Record<string, { toolId: string; input: any; output: any }[]>;

  constructor(cache: CacheBackend) {
    this.cache = cache;

    this.sequences = {};
  }

  async checkToolCall(
    pageId: string,
    toolId: string,
    input: Record<string, any>
  ): Promise<{ cached: any; hit: boolean; steps: any[] }> {
    const sequence = this.sequences[pageId] || [];

    // TODO: pull out helper for this part, use it in recordToolCall
    input = omit(input, ['pageId']);
    const inputs = sequence.map((it) => ({
      toolId: it.toolId,
      input: it.input,
    }));
    inputs.push({ toolId, input });
    const key = hash({ cacheVersion, inputs });

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
    pageId: string,
    toolId: string,
    input: Record<string, any>,
    output: unknown
  ) {
    this.sequences[pageId] ||= [];
    const sequence = this.sequences[pageId];
    sequence.push({
      toolId,
      input: omit(input, ['pageId']),
      output,
    });

    const inputs = sequence.map((it) => ({
      toolId: it.toolId,
      input: it.input,
    }));
    const key = hash({ cacheVersion, inputs });
    const cached = sequence.at(-1)?.output;

    log.debug(
      `Browser cache set: tool=${toolId}, key=${key.slice(0, 12)}, prefixLength=${sequence.length}`
    );

    await this.cache.set(key, cached);
  }
}
