import { omit } from 'radash';
import { type DiskCache } from '../../cache/DiskCache.js';
import { hash } from '../../util.js';

type CacheBackend = Pick<DiskCache, 'get' | 'set'>;

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
    const key = hash(inputs);

    const cached = await this.cache.get(key);

    console.log('Check tool for inputs:', key, inputs);
    console.log('Check tool call gave:', key, cached);

    if (cached) {
      return { cached, hit: true, steps: [] };
    } else {
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
    console.log('BrowserToolCache.recordToolCall:', pageId, toolId, input, output);

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
    const key = hash(inputs);
    const cached = sequence.at(-1)?.output;

    console.log('Browser cache sequence:', key, sequence.length, inputs);

    await this.cache.set(key, cached);
  }
}
