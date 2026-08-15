import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

let id = 1;
type FetchResponse = {
  url: string;
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
};

const docs: Record<string, FetchResponse> = {};

export const fetchTool = createTool({
  id: 'fetchTool',
  description: "Fetch a URL using Node's built-in fetch() function.",
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe('URL to fetch. Include the scheme, for example https://example.com.'),
  }),
  outputSchema: z.object({
    url: z.string(),
    ok: z.boolean(),
    status: z.number(),
    statusText: z.string(),
    documentId: z.string(),
  }),
  execute: async ({ url }, { abortSignal }) => {
    const documentId = 'DOC' + id++;

    const resp = await fetch(url, { signal: abortSignal });
    const out: FetchResponse = {
      url: resp.url,
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      headers: Object.fromEntries(resp.headers),
      body: await resp.text(),
    };

    docs[documentId] = out;

    return {
      documentId,
      url: out.url,
      ok: out.ok,
      status: out.status,
      statusText: out.statusText,
    };
  },
});

export const viewDocumentTool = createTool({
  id: 'viewDocumentTool',
  description: 'Get response body for a previously loaded URL.',
  inputSchema: z.object({
    documentId: z.string().describe('Document ID to view, provided by a document loader tool.'),
    mode: z.enum(['full', 'slim', 'markdown']).describe(`How to view the document.
"full": Gives full document HTML.
"slim": Gives a subset of the HTML most likely to be relevant for data extraction.
"markdown": Gives markdown.
      `),
  }),
  outputSchema: z.object({
    headers: z.record(z.string(), z.string()),
    body: z.string(),
  }),
  execute: async ({ documentId }) => {
    return {
      headers: docs[documentId].headers,
      body: docs[documentId].body,
    };
  },
});
