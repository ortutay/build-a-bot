import { describe, expect, it } from 'vitest';
import { documentLibrary } from '../../../src/documents/index.js';
import { executors } from '../../../src/tools/documents/tools.js';

describe('document tools', () => {
  it('lists saved documents and gets a selected representation', async () => {
    const documentId = documentLibrary.save({
      url: 'https://example.test/catalog',
      origin: 'page',
      contentType: 'text/html',
      headers: { 'x-source': 'test' },
      content: '<html><body><h1>Catalog</h1></body></html>',
    });

    await expect(executors.listTool({ documentIds: [documentId] })).resolves.toEqual({
      documents: [
        expect.objectContaining({
          id: documentId,
          url: 'https://example.test/catalog',
          origin: 'page',
          contentType: 'text/html',
        }),
      ],
    });
    await expect(
      executors.getTool({ documentId, format: 'slimHtml', transform: 'none' })
    ).resolves.toMatchObject({
      id: documentId,
      headers: { 'x-source': 'test' },
      format: 'slimHtml',
      transform: 'none',
      content: expect.stringContaining('Catalog'),
    });
  });

  it('rejects unknown document IDs', async () => {
    await expect(
      executors.getTool({ documentId: 'doc:missing', format: 'raw', transform: 'none' })
    ).rejects.toThrow('Unknown document ID: doc:missing');
  });
});
