import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  documentContentTypes,
  documentFormats,
  documentLibrary,
  documentOrigins,
  documentTransforms,
  type DocumentId,
  type DocumentListQuery,
} from '../../documents/index.js';
import { addInstruments, runtimeInstrument } from '../../instruments/index.js';

const prefix = (str: string): string => 'documentTools_' + str;

type GetDocumentInput = {
  documentId: DocumentId;
  format: (typeof documentFormats)[number];
  transform: (typeof documentTransforms)[number];
};

const documentSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  origin: z.enum(documentOrigins),
  contentType: z.enum(documentContentTypes),
  bytes: z.number().int().nonnegative(),
});

export const executors: Record<string, any> = {
  listTool: async (query: DocumentListQuery) => ({
    documents: documentLibrary.list(query),
  }),
  getTool: async ({ documentId, format, transform }: GetDocumentInput) => {
    const document = documentLibrary.get(documentId, format, transform);
    if (!document) throw new Error(`Unknown document ID: ${documentId}`);
    return document;
  },
};

const listTool = createTool({
  id: prefix('listTool'),
  description: 'List saved documents and their metadata without returning document content.',
  inputSchema: z.object({
    documentIds: z.array(z.string()).optional(),
    origin: z.enum(documentOrigins).optional(),
    contentType: z.enum(documentContentTypes).optional(),
    urlPrefix: z.string().optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().nonnegative().max(50).optional(),
  }),
  outputSchema: z.object({
    documents: z.array(documentSummarySchema),
  }),
  execute: executors.listTool,
});

const getTool = createTool({
  id: prefix('getTool'),
  description: `Get a saved document in a selected format and transform.
For HTML, prefer "slimHtml" because it removes page noise while retaining useful text and links.
Use transform "collapse" with HTML to collapse unexpanded page sections, or with JSON to reduce long arrays to their head and tail.
Use slimHtml plus collapse whenever it provides enough detail, to reduce context use.
Treat raw full HTML and raw full JSON as fallbacks when the compact view omits information you need.`,
  inputSchema: z.object({
    documentId: z.string().describe('Document ID returned by a document-producing tool.'),
    format: z
      .enum(documentFormats)
      .default('raw')
      .describe('Use slimHtml for compact HTML; use raw for full HTML or JSON only when needed.'),
    transform: z
      .enum(documentTransforms)
      .default('none')
      .describe(
        'Use collapse to reduce HTML sections or long JSON arrays before falling back to full content.'
      ),
  }),
  outputSchema: documentSummarySchema.extend({
    headers: z.record(z.string(), z.string()),
    format: z.enum(documentFormats),
    transform: z.enum(documentTransforms),
    content: z.string(),
  }),
  execute: executors.getTool,
});

const internal = [listTool, getTool];

export const createDocumentTools = async (): Promise<Record<string, Tool>> => {
  return Object.fromEntries(
    (await Promise.all(internal.map((tool) => addInstruments([runtimeInstrument], tool)))).map(
      (tool) => [tool.id, tool]
    )
  );
};

export const tools = await createDocumentTools();
