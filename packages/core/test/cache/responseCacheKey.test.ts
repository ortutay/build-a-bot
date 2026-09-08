import { InMemoryServerCache } from '@mastra/core/cache';
import { describe, expect, it } from 'vitest';
import { responseCacheHashInput } from '../../src/cache/responseCacheKey.js';
import { hash } from '../../src/util/index.js';

type RunMetadata = {
  timestamp: string;
  runtimeMs: number;
  maxRetries: number;
  responseDate: string;
};

const promptForRun = (metadata: RunMetadata) => [
  { role: 'system', content: 'Extract the Pokemon name.' },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolName: 'fetch',
        input: {
          url: 'https://pokeapi.co/api/v2/pokemon/pikachu',
          _background: {
            enabled: false,
            maxRetries: metadata.maxRetries,
            timeoutMs: 20_000,
          },
        },
        output: {
          value: {
            documentId: 'doc:pikachu',
            content: '{"name":"pikachu"}',
            headers: { date: metadata.responseDate },
            request: {
              timestamp: metadata.timestamp,
              headers: {},
              proxy: null,
              mode: 'fetch',
            },
            instruments: { metrics: { runtimeMs: metadata.runtimeMs } },
          },
        },
      },
    ],
  },
];

const cacheKeyForPrompt = (prompt: unknown): string =>
  hash(
    responseCacheHashInput({
      cacheBuster: 'test',
      tools: ['fetch:{input-schema}:{output-schema}'],
      prompt,
    })
  );

const cacheKeyForRun = (metadata: RunMetadata): string => cacheKeyForPrompt(promptForRun(metadata));

describe('response cache key', () => {
  it('hits across runs when only execution metadata changes', async () => {
    const firstKey = cacheKeyForRun({
      timestamp: '2026-08-24T20:15:40.274Z',
      runtimeMs: 128,
      maxRetries: 3,
      responseDate: 'Sun, 24 Aug 2026 20:15:40 GMT',
    });
    const secondKey = cacheKeyForRun({
      timestamp: '2026-08-24T20:15:55.428Z',
      runtimeMs: 412,
      maxRetries: 7,
      responseDate: 'Sun, 24 Aug 2026 20:15:40 GMT',
    });
    const cache = new InMemoryServerCache();

    await cache.set(firstKey, { text: 'Pikachu is an Electric-type Pokemon.' });

    expect(secondKey).toBe(firstKey);
    await expect(cache.get(secondKey)).resolves.toEqual({
      text: 'Pikachu is an Electric-type Pokemon.',
    });
  });

  it('does not mutate the tool result while serializing it', () => {
    const prompt = promptForRun({
      timestamp: '2026-08-24T20:15:40.274Z',
      runtimeMs: 128,
      maxRetries: 3,
      responseDate: 'Sun, 24 Aug 2026 20:15:40 GMT',
    });
    const before = structuredClone(prompt);

    cacheKeyForPrompt(prompt);

    expect(prompt).toEqual(before);
  });

  it('misses when the tool result content changes', () => {
    const firstKey = cacheKeyForRun({
      timestamp: '2026-08-24T20:15:40.274Z',
      runtimeMs: 128,
      maxRetries: 3,
      responseDate: 'Sun, 24 Aug 2026 20:15:40 GMT',
    });
    const changedContentKey = cacheKeyForPrompt([
      { role: 'system', content: 'Extract the Pokemon name.' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolName: 'fetch',
            input: { url: 'https://pokeapi.co/api/v2/pokemon/pikachu' },
            output: { value: { content: '{"name":"raichu"}' } },
          },
        ],
      },
    ]);

    expect(changedContentKey).not.toBe(firstKey);
  });

  it.fails('hits across runs when only response headers change', () => {
    const firstKey = cacheKeyForRun({
      timestamp: '2026-08-24T20:15:40.274Z',
      runtimeMs: 128,
      maxRetries: 3,
      responseDate: 'Sun, 24 Aug 2026 20:15:40 GMT',
    });
    const secondKey = cacheKeyForRun({
      timestamp: '2026-08-24T20:15:55.428Z',
      runtimeMs: 412,
      maxRetries: 7,
      responseDate: 'Sun, 24 Aug 2026 20:15:55 GMT',
    });

    expect(secondKey).toBe(firstKey);
  });
});
