import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { slimHtml } from '../formats.js';
import { hash } from '../util.js';
import { names as proxyNames, proxyFetch } from '../proxy.js';

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
    proxy: z
      .enum(proxyNames)
      .describe(`One of: ${proxyNames.map((name) => `"${name}"`).join(', ')}.`),
  }),
  outputSchema: z.object({
    url: z.string(),
    ok: z.boolean(),
    status: z.number(),
    statusText: z.string(),
    documentId: z.string(),
  }),
  execute: async ({ url, proxy }) => {
    const documentId =
      'doc:' +
      hash({ url, proxy }).substring(0, 8) +
      ':' +
      url.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const resp = await proxyFetch(url, proxy);
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
  description: 'Get HTML for a previously loaded URL.',
  inputSchema: z.object({
    documentId: z.string().describe('Document ID to view, provided by a document loader tool.'),
    mode: z.enum(['html', 'slim']).describe(`How to view the document.
"html": Gives the complete response HTML.
"slim": Gives cleaned HTML for efficient inspection and data extraction.`),
  }),
  outputSchema: z.object({
    headers: z.record(z.string(), z.string()),
    body: z.string(),
  }),
  execute: async ({ documentId, mode }) => {
    const document = docs[documentId];
    if (!document) throw new Error(`Unknown document ID: ${documentId}`);

    return {
      headers: document.headers,
      body: mode === 'slim' ? slimHtml({ html: document.body, url: document.url }) : document.body,
    };
  },
});
