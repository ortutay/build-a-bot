import { omit } from 'radash';
import { chromium, type Browser, type Page } from 'playwright';
import { DiskCache } from '../../cache/DiskCache.js';
import { hash } from '../../util.js';

export class BrowserToolCache {
  cache: DiskCache;
  sequences: Record<string, { toolId: string; input: any; output: any }[]>;

  constructor() {
    this.cache = new DiskCache('/tmp/builder/BrowserToolCache');

    this.sequences = {};
  }

  async checkToolCall(
    pageId: string,
    toolId: string,
    input: Record<string, any>
  ): Promise<unknown> {
    const sequence = this.sequences[pageId];
    if (!sequence) {
      return null;
    }

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

    return cached;
  }

  replayToolCalls(pageId: string, page: Page): Promise<unknown> {
    return Promise.resolve('todo');
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
