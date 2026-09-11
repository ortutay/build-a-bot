import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  documentContentTypes,
  type ContentType,
  type DocumentHeaders,
  type DocumentLibrary,
} from '../../../documents/index.js';
import {
  addInstruments,
  cacheInstrument,
  markAvailableTool,
  runtimeInstrument,
} from '../../instruments/index.js';
import { names as proxyNames, proxyFetch } from '../../../legacyProxy.js';
import { parseResponseBody } from '../../../util/index.js';

const contentTypeFromHeaders = (headers: DocumentHeaders): ContentType => {
  const contentType = headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (!contentType) return 'text/html';

  const supportedContentType = documentContentTypes.find((type) => type === contentType);
  if (!supportedContentType) {
    throw new Error(`Unsupported fetch content type: ${contentType}`);
  }
  return supportedContentType;
};

type FetchToolInput = {
  url: string;
  proxy: (typeof proxyNames)[number];
};

export const executors: Record<string, any> = {
  fetchTool: async (documentLibrary: DocumentLibrary, { url, proxy }: FetchToolInput) => {
    const timestamp = new Date().toISOString();
    const requestHeaders: DocumentHeaders = {};
    const resp = await proxyFetch(url, proxy);
    const headers = Object.fromEntries(resp.headers);
    const contentType = contentTypeFromHeaders(headers);
    const content = parseResponseBody(contentType, await resp.arrayBuffer());
    const useUrl = proxy === 'unblock' ? url : resp.url || url;
    const documentId = documentLibrary.save({
      url: useUrl,
      origin: 'dynamic',
      contentType,
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
      url: useUrl,
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      bytes: content.length,
    };
  },
};

const createFetchTool = (documentLibrary: DocumentLibrary): any =>
  createTool({
    id: 'fetchTool',
    description: "Fetch a URL using Node's built-in fetch() function.",
    inputSchema: z.object({
      url: z
        .string()
        .describe('URL to fetch. Include the scheme, for example https://example.com.'),
      proxy: z
        .enum(proxyNames)
        .describe(`One of: ${proxyNames.map((name) => `"${name}"`).join(', ')}.`),
    }),
    outputSchema: z.object({
      documentId: z.string(),
      url: z.string(),
      ok: z.boolean(),
      status: z.number(),
      statusText: z.string(),
      bytes: z.number(),
    }),
    execute: (...args) => executors.fetchTool(documentLibrary, ...args),
  });

export type CreateFetchToolsOptions = {
  documentLibrary: DocumentLibrary;
};

export const createTools = async (
  options: CreateFetchToolsOptions
): Promise<Record<string, Tool>> => {
  const internal = [createFetchTool(options.documentLibrary)];
  return Object.fromEntries(
    (
      await Promise.all(
        internal.map((tool) =>
          addInstruments([cacheInstrument, runtimeInstrument, markAvailableTool], tool)
        )
      )
    ).map((tool) => [tool.id, tool])
  );
};
