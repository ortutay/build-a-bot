import { describe, expect, it } from 'vitest';
import {
  DocumentLibrary,
  type DocumentInput,
} from '../../src/internal/documents/DocumentLibrary.js';
import { MemoryLibraryBackend } from '../../src/internal/documents/MemoryLibraryBackend.js';

const documentInput = (overrides: Partial<DocumentInput> = {}): DocumentInput => ({
  url: 'https://pokeapi.co/api/v2/pokemon/pikachu',
  origin: 'dynamic',
  contentType: 'application/json',
  status: 200,
  headers: { date: 'Sun, 24 Aug 2026 20:15:40 GMT' },
  request: {
    timestamp: '2026-08-24T20:15:40.274Z',
    headers: { 'x-request-id': 'first-run' },
    proxy: null,
    mode: 'fetch',
  },
  content: '{"name":"pikachu"}',
  ...overrides,
});

describe('document identity', () => {
  it('is stable across repeated fetches with different timestamps and headers', () => {
    const library = new DocumentLibrary(new MemoryLibraryBackend());
    const firstId = library.save(documentInput());
    const secondId = library.save(
      documentInput({
        headers: { date: 'Sun, 24 Aug 2026 20:15:55 GMT' },
        request: {
          timestamp: '2026-08-24T20:15:55.428Z',
          headers: { 'x-request-id': 'second-run' },
          proxy: null,
          mode: 'fetch',
        },
      })
    );

    expect(secondId).toBe(firstId);
  });

  it('changes when the fetched content changes', () => {
    const library = new DocumentLibrary(new MemoryLibraryBackend());
    const firstId = library.save(documentInput());
    const secondId = library.save(documentInput({ content: '{"name":"raichu"}' }));

    expect(secondId).not.toBe(firstId);
  });

  it.fails('keeps concurrent browser requests distinct before their response bodies arrive', () => {
    const library = new DocumentLibrary(new MemoryLibraryBackend());
    const provisionalRequest = documentInput({
      status: null,
      headers: {},
      request: {
        timestamp: '2026-08-24T20:15:40.274Z',
        headers: {},
        proxy: null,
        mode: 'browser',
      },
      content: '',
    });

    const firstId = library.save(provisionalRequest);
    const secondId = library.save(provisionalRequest);

    expect(secondId).not.toBe(firstId);
  });
});
