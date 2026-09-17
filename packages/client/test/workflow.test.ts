import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataService } from '@build-a-bot/core';
import { exercise } from '../src/workflow.js';

vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe('client workflow outcomes', () => {
  it.each(['errors', 'unhandled'] as const)(
    'fails on %s even with existing items',
    async (field) => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const outcome = {
        success: [],
        unhandled: [],
        errors: [],
        [field]: [{ url: 'https://example.com/jobs', error: 'Extraction failed' }],
      };
      const service = {
        name: 'test',
        sources: [{ url: 'https://example.com/jobs' }],
        build: vi.fn(),
        sync: vi.fn().mockResolvedValue({ created: [], updated: [], outcome }),
        list: vi.fn().mockResolvedValue({ total: 1, count: 1, results: [{ title: 'Old job' }] }),
      };

      expect(await exercise(service as unknown as DataService, 1)).toBe(false);
      expect(service.sync).toHaveBeenCalledTimes(3);
    }
  );

  it('accepts a successful empty source when no minimum was requested', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const service = {
      name: 'test',
      sources: [{ url: 'https://example.com/jobs' }],
      build: vi.fn(),
      sync: vi.fn().mockResolvedValue({
        created: [],
        updated: [],
        outcome: { success: [{ url: 'https://example.com/jobs' }], unhandled: [], errors: [] },
      }),
      list: vi.fn().mockResolvedValue({ total: 0, count: 0, results: [] }),
    };

    expect(await exercise(service as unknown as DataService)).toBe(true);
  });
});
