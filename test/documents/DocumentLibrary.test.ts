import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskLibraryBackend } from '../../src/documents/DiskLibraryBackend.js';
import {
  DocumentLibrary,
  type DocumentId,
  type DocumentInput,
  type DocumentRequest,
} from '../../src/documents/DocumentLibrary.js';
import { MemoryLibraryBackend } from '../../src/documents/MemoryLibraryBackend.js';

const createMemoryLibrary = () => new DocumentLibrary(new MemoryLibraryBackend());

const request = (mode: DocumentRequest['mode'] = 'fetch'): DocumentRequest => ({
  timestamp: '2026-08-20T00:00:00.000Z',
  headers: { 'x-request-header': 'original' },
  proxy: mode === 'fetch' ? 'unblock' : null,
  mode,
});

const saveHtml = (library: DocumentLibrary, url = 'https://example.test/page'): DocumentId =>
  library.save({
    url,
    origin: 'dynamic',
    contentType: 'text/html',
    status: 200,
    headers: { 'content-type': 'text/html' },
    request: request(),
    content:
      '<html><body><script>ignored()</script><svg></svg><div><div>Nested content</div></div><a href="/next">Next</a></body></html>',
  });

describe('DocumentLibrary', () => {
  it('saves document metadata, headers, and byte size', () => {
    const library = createMemoryLibrary();
    const headers = { 'x-request-id': 'abc123' };
    const documentRequest = request();
    const id = library.save({
      url: 'https://example.test/data',
      origin: 'dynamic',
      contentType: 'application/json',
      status: 201,
      headers,
      request: documentRequest,
      content: 'héllo',
    });
    headers['x-request-id'] = 'changed';
    documentRequest.headers['x-request-header'] = 'changed';

    expect(library.summary(id)).toEqual({
      id,
      url: 'https://example.test/data',
      origin: 'dynamic',
      contentType: 'application/json',
      status: 201,
      bytes: Buffer.byteLength('héllo', 'utf8'),
    });
    expect(library.get({ documentId: id })).toMatchObject({
      headers: { 'x-request-id': 'abc123' },
      request: {
        timestamp: '2026-08-20T00:00:00.000Z',
        headers: { 'x-request-header': 'original' },
        proxy: 'unblock',
        mode: 'fetch',
      },
      format: 'raw',
      transform: 'none',
      content: 'héllo',
    });
  });

  it('updates saved documents and recalculates their byte size', () => {
    const library = createMemoryLibrary();
    const id = saveHtml(library);
    const headers = { 'content-type': 'application/json' };
    const content = '{"updated":true}';
    const input: DocumentInput = {
      url: 'https://example.test/page',
      origin: 'dynamic',
      contentType: 'application/json',
      status: 202,
      headers,
      request: request(),
      content,
    };

    library.update(id, input);
    headers['content-type'] = 'changed';

    expect(library.summary(id)).toEqual({
      id,
      url: 'https://example.test/page',
      origin: 'dynamic',
      contentType: 'application/json',
      status: 202,
      bytes: Buffer.byteLength(content, 'utf8'),
    });
    expect(library.get({ documentId: id })).toMatchObject({
      headers: { 'content-type': 'application/json' },
      content,
    });
    expect(() => library.update('doc:missing', input)).toThrow('Unknown document ID: doc:missing');
  });

  it('applies HTML formats and collapse transforms independently through formats.ts', () => {
    const library = createMemoryLibrary();
    const id = saveHtml(library);

    expect(library.get({ documentId: id, format: 'raw' })?.content).toContain('ignored()');
    expect(library.get({ documentId: id, format: 'html' })?.content).not.toContain('<svg');
    expect(library.get({ documentId: id, format: 'slimHtml' })?.content).not.toContain('ignored()');
    expect(library.get({ documentId: id, format: 'slimHtml' })?.content).toContain(
      'https://example.test/next'
    );
    expect(
      library.get({ documentId: id, format: 'raw', transform: 'collapse' })?.content
    ).toContain('data-collapse-id');
    expect(
      library.get({ documentId: id, format: 'slimHtml', transform: 'collapse' })?.content
    ).toContain('data-collapse-id');
  });

  it('collapses long JSON arrays while retaining their head and tail', () => {
    const library = createMemoryLibrary();
    const content = JSON.stringify({ items: Array.from({ length: 20 }, (_, index) => index) });
    const id = library.save({
      url: 'https://example.test/data.json',
      origin: 'navigation',
      contentType: 'application/json',
      status: 200,
      headers: {},
      request: request('browser'),
      content,
    });

    expect(
      JSON.parse(library.get({ documentId: id, format: 'raw', transform: 'collapse' })!.content)
    ).toEqual({
      items: [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        { $collapsed: { omitted: 4 } },
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        19,
      ],
    });
  });

  it('lists serializable subsets with offset and a bounded limit', () => {
    const library = createMemoryLibrary();
    const first = saveHtml(library, 'https://example.test/catalog/one');
    const second = library.save({
      url: 'https://example.test/api/two',
      origin: 'navigation',
      contentType: 'application/json',
      status: 200,
      headers: {},
      request: request('browser'),
      content: '{}',
    });
    const third = saveHtml(library, 'https://other.test/catalog/three');

    expect(library.list({ documentIds: [second, first] })).toEqual([
      library.summary(first),
      library.summary(second),
    ]);
    expect(
      library.list({ origin: 'dynamic', urlPrefix: 'https://example.test/', limit: 1 })
    ).toEqual([library.summary(first)]);
    expect(library.list({ contentType: 'text/html', offset: 1 })).toEqual([library.summary(third)]);
    expect(library.list({ contentType: 'text/html' })).not.toContainEqual(library.summary(second));
    expect(library.list({ documentIds: [third], limit: 0 })).toEqual([]);
  });

  it('returns null for missing documents and rejects unavailable formats', () => {
    const library = createMemoryLibrary();
    const id = library.save({
      url: 'https://example.test/data.json',
      origin: 'dynamic',
      contentType: 'application/json',
      status: 200,
      headers: {},
      request: request(),
      content: '{}',
    });

    expect(library.summary('doc:missing')).toBeNull();
    expect(library.get({ documentId: 'doc:missing' })).toBeNull();
    expect(() => library.get({ documentId: id, format: 'slimHtml' })).toThrow(
      'Format "slimHtml" is unavailable for application/json'
    );
  });

  it('gets multiple documents using per-document render options', () => {
    const library = createMemoryLibrary();
    const htmlId = saveHtml(library);
    const jsonId = library.save({
      url: 'https://example.test/data.json',
      origin: 'dynamic',
      contentType: 'application/json',
      status: 200,
      headers: {},
      request: request(),
      content: '{"ok":true}',
    });

    expect(
      library.getMany([
        { documentId: jsonId },
        { documentId: htmlId, format: 'slimHtml' },
        { documentId: 'doc:missing' },
      ])
    ).toMatchObject([
      { id: jsonId, format: 'raw', transform: 'none', content: '{"ok":true}' },
      { id: htmlId, format: 'slimHtml', transform: 'none' },
      null,
    ]);
  });

  it('uses the configured path for persistent documents', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-documents-'));
    try {
      const writer = new DocumentLibrary(
        new DiskLibraryBackend('documentLibrary', { rootDir: directory })
      );
      const id = saveHtml(writer);
      const reader = new DocumentLibrary(
        new DiskLibraryBackend('documentLibrary', { rootDir: directory })
      );

      expect(reader.summary(id)).toEqual(writer.summary(id));
      expect(reader.get({ documentId: id })).toMatchObject({
        content: expect.stringContaining('Nested content'),
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
