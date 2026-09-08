import { describe, expect, it } from 'vitest';
import { DocumentLibrary } from '../../../src/documents/index.js';
import { executors } from '../../../src/mastra/tools/documents/tools.js';

describe('document tools', () => {
  it('lists saved documents and gets a selected representation', async () => {
    const documentLibrary = new DocumentLibrary();
    const documentId = documentLibrary.save({
      url: 'https://example.test/catalog',
      origin: 'navigation',
      contentType: 'text/html',
      status: 200,
      headers: { 'x-source': 'test' },
      request: {
        timestamp: '2026-08-20T00:00:00.000Z',
        headers: {},
        proxy: null,
        mode: 'browser',
      },
      content: '<html><body><h1>Catalog</h1></body></html>',
    });

    await expect(
      executors.listTool(documentLibrary, { documentIds: [documentId] })
    ).resolves.toEqual({
      documents: [
        expect.objectContaining({
          id: documentId,
          url: 'https://example.test/catalog',
          origin: 'navigation',
          contentType: 'text/html',
          status: 200,
        }),
      ],
    });
    await expect(
      executors.getTool(documentLibrary, { documentId, format: 'slimHtml', transform: 'none' })
    ).resolves.toMatchObject({
      id: documentId,
      headers: { 'x-source': 'test' },
      request: {
        timestamp: '2026-08-20T00:00:00.000Z',
        headers: {},
        proxy: null,
        mode: 'browser',
      },
      format: 'slimHtml',
      transform: 'none',
      content: expect.stringContaining('Catalog'),
    });
  });

  it('rejects unknown document IDs', async () => {
    const documentLibrary = new DocumentLibrary();
    await expect(
      executors.getTool(documentLibrary, {
        documentId: 'doc:missing',
        format: 'raw',
        transform: 'none',
      })
    ).rejects.toThrow('Unknown document ID: doc:missing');
  });

  it('gets multiple documents with independently selected representations', async () => {
    const documentLibrary = new DocumentLibrary();
    const htmlId = documentLibrary.save({
      url: 'https://example.test/catalog',
      origin: 'navigation',
      contentType: 'text/html',
      status: 200,
      headers: {},
      request: {
        timestamp: '2026-08-20T00:00:00.000Z',
        headers: {},
        proxy: null,
        mode: 'browser',
      },
      content: '<html><body><script>ignored()</script><h1>Catalog</h1></body></html>',
    });
    const textId = documentLibrary.save({
      url: 'https://example.test/readme.txt',
      origin: 'dynamic',
      contentType: 'text/plain',
      status: 200,
      headers: {},
      request: {
        timestamp: '2026-08-20T00:00:00.000Z',
        headers: {},
        proxy: 'unblock',
        mode: 'fetch',
      },
      content: 'Read me',
    });

    await expect(
      executors.getManyTool(documentLibrary, {
        documents: [
          { documentId: textId, format: 'raw', transform: 'none' },
          { documentId: htmlId, format: 'slimHtml', transform: 'none' },
        ],
      })
    ).resolves.toMatchObject({
      documents: [
        { id: textId, content: 'Read me', format: 'raw', transform: 'none' },
        {
          id: htmlId,
          content: expect.stringContaining('Catalog'),
          format: 'slimHtml',
          transform: 'none',
        },
      ],
    });
  });

  it('rejects a batch containing an unknown document ID', async () => {
    const documentLibrary = new DocumentLibrary();
    await expect(
      executors.getManyTool(documentLibrary, {
        documents: [{ documentId: 'doc:missing', format: 'raw', transform: 'none' }],
      })
    ).rejects.toThrow('Unknown document ID: doc:missing');
  });
});
