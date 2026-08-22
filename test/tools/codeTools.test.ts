import { describe, expect, it } from 'vitest';
import { documentLibrary } from '../../src/documents/index.js';
import { tools } from '../../src/tools/codeTools/tools.js';

const runSnippet = async (code: string) => {
  const execute = tools.codeTools_runJsSnippetTool.execute;
  if (!execute) throw new Error('Code tool has no execute function');

  return execute({ code }, {
    agent: { agentId: 'test-agent' },
    mastra: {
      getAgentById: () => ({ listTools: async () => ({}) }),
    },
  } as any);
};

describe('code tools', () => {
  it('exposes a read-only document library to snippets', async () => {
    const documentId = documentLibrary.save({
      url: 'https://example.test/catalog',
      origin: 'navigation',
      contentType: 'text/html',
      status: 200,
      headers: {},
      request: {
        timestamp: '2026-08-21T00:00:00.000Z',
        headers: {},
        proxy: null,
        mode: 'browser',
      },
      content: '<html><body><h1>Catalog</h1></body></html>',
    });

    await expect(
      runSnippet(`
        export const run = async () => ({
          document: documentLibrary.get({ documentId: '${documentId}' }),
          methods: Object.keys(documentLibrary).sort(),
          saveType: typeof documentLibrary.save,
        });
      `)
    ).resolves.toMatchObject({
      document: { id: documentId, content: expect.stringContaining('Catalog') },
      methods: ['get', 'getMany', 'list', 'summary'],
      saveType: 'undefined',
    });
  });
});
