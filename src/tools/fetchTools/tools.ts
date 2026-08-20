import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  documentContentTypes,
  documentLibrary,
  type ContentType,
  type DocumentHeaders,
} from '../../documents/index.js';
import { addInstruments, runtimeInstrument } from '../../instruments/index.js';
import { names as proxyNames, proxyFetch } from '../../proxy.js';

const contentTypeFromHeaders = (headers: DocumentHeaders): ContentType => {
  const contentType = headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (!contentType) return 'text/html';

  const supportedContentType = documentContentTypes.find((type) => type === contentType);
  if (!supportedContentType) {
    throw new Error(`Unsupported fetch content type: ${contentType}`);
  }
  return supportedContentType;
};

const fetchTool = createTool({
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
    const timestamp = new Date().toISOString();
    const requestHeaders: DocumentHeaders = {};
    const resp = await proxyFetch(url, proxy);
    const headers = Object.fromEntries(resp.headers);
    const content = await resp.text();
    const documentId = documentLibrary.save({
      url: resp.url,
      origin: 'dynamic',
      contentType: contentTypeFromHeaders(headers),
      status: resp.status,
      headers,
      request: {
        timestamp,
        headers: requestHeaders,
        proxy,
        mode: 'fetch',
      },
      content,
    });

    return {
      documentId,
      url: resp.url,
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
    };
  },
});

const internal = [fetchTool];

export const createFetchTools = async (): Promise<Record<string, Tool>> => {
  return Object.fromEntries(
    (await Promise.all(internal.map((tool) => addInstruments([runtimeInstrument], tool)))).map(
      (tool) => [tool.id, tool]
    )
  );
};

export const tools = await createFetchTools();
