import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import type { GlobalContext } from '../../../context/index.js';
import {
  documentContentTypes,
  type ContentType,
  type DocumentHeaders,
  type DocumentLibrary,
} from '../../../documents/index.js';
import { isHttpProxy, type ProxyRegistry } from '../../../proxy/index.js';
import { parseResponseBody } from '../../../util/index.js';
import {
  addInstruments,
  cacheInstrument,
  markAvailableTool,
  runtimeInstrument,
} from '../../instruments/index.js';

export const close = async (_context: GlobalContext): Promise<void> => {};

const contentTypeFromHeaders = (headers: DocumentHeaders): ContentType => {
  const contentType = headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (!contentType) {
    return 'text/html';
  }

  const supportedContentType = documentContentTypes.find((type) => type === contentType);
  if (!supportedContentType) {
    throw new Error(`Unsupported fetch content type: ${contentType}`);
  }
  return supportedContentType;
};

const makeFetchInputSchema = <T extends z.ZodType<string>>(proxy: T) =>
  z
    .object({
      method: z.enum(['GET', 'POST']).default('GET'),
      headers: z
        .record(z.string(), z.string())
        .nullish()
        .transform((val) => val ?? {}),
      body: z
        .string()
        .max(1_000_000)
        .nullish()
        .transform((val) => val || undefined),
      readOnly: z.boolean().optional(),
      timeout: z.number().int().min(1).max(120000).default(30000),
      url: z
        .string()
        .describe('URL to fetch. Include the scheme, for example https://example.com.'),
      proxy,
    })
    .refine(
      (input) => input.method !== 'POST' || input.readOnly === true,
      'POST is only available for explicitly read-only queries'
    )
    .refine(
      (input) => input.method !== 'GET' || input.body === undefined,
      'GET cannot have a body'
    );

const fetchInputSchema = makeFetchInputSchema(z.string());
const fetchOutputSchema = z.object({
  documentId: z.string(),
  url: z.string(),
  ok: z.boolean(),
  status: z.number(),
  statusText: z.string(),
  bytes: z.number(),
});

type FetchToolInput = z.input<typeof fetchInputSchema>;
type FetchToolResult = z.infer<typeof fetchOutputSchema>;

export const executors: Record<string, any> = {
  fetchTool: async (
    documentLibrary: DocumentLibrary,
    proxyRegistry: ProxyRegistry,
    input: FetchToolInput
  ): Promise<FetchToolResult> => {
    const {
      url,
      proxy,
      method,
      headers: requestHeaders,
      body,
      timeout,
    } = fetchInputSchema.parse(input);
    const spec = proxyRegistry.require(proxy);
    if (!isHttpProxy(spec)) {
      throw new Error(`Proxy "${proxy}" does not support fetch().`);
    }
    const timestamp = new Date().toISOString();
    const resp = await spec.fetch(url, requestHeaders, {
      method,
      body,
      signal: AbortSignal.timeout(timeout),
    });
    const headers = Object.fromEntries(resp.headers);
    const contentType = contentTypeFromHeaders(headers);
    const content = parseResponseBody(contentType, await resp.arrayBuffer());
    const useUrl = resp.url || url;
    const documentId = documentLibrary.save({
      url: useUrl,
      origin: 'dynamic',
      contentType,
      status: resp.status,
      headers,
      request: {
        timestamp,
        method,
        body: body ?? null,
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

const createFetchTool = ({ documentLibrary, proxyRegistry }: CreateFetchToolsOptions): any => {
  const proxyNames = proxyRegistry
    .list()
    .filter(isHttpProxy)
    .map((proxy) => proxy.id);
  return createTool({
    id: 'fetchTool',
    description:
      'Fetch HTTP content or a read-only JSON/search endpoint. POST requires readOnly:true; never use for application submission or other mutations. Method, headers and body participate in cache identity.',
    inputSchema: makeFetchInputSchema(
      z.enum(proxyNames).describe(`One of: ${proxyNames.map((name) => `"${name}"`).join(', ')}.`)
    ),
    outputSchema: fetchOutputSchema,
    execute: (...args) => executors.fetchTool(documentLibrary, proxyRegistry, ...args),
  });
};

export type CreateFetchToolsOptions = {
  documentLibrary: DocumentLibrary;
  proxyRegistry: ProxyRegistry;
};

export const createTools = async (
  options: CreateFetchToolsOptions
): Promise<Record<string, Tool>> => {
  if (!options.proxyRegistry.list().some(isHttpProxy)) {
    return {};
  }
  const internal = [createFetchTool(options)];
  return Object.fromEntries(
    (
      await Promise.all(
        internal.map((tool) =>
          addInstruments(
            [
              (tool) => cacheInstrument(tool, options.documentLibrary.cacheScope),
              runtimeInstrument,
              markAvailableTool,
            ],
            tool
          )
        )
      )
    ).map((tool) => [tool.id, tool])
  );
};
