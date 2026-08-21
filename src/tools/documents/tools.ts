import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  documentContentTypes,
  documentFormats,
  documentLibrary,
  documentOrigins,
  documentRequestModes,
  documentTransforms,
  type Document,
  type DocumentGetInput,
  type DocumentId,
  type DocumentListQuery,
} from '../../documents/index.js';
import { addInstruments, runtimeInstrument } from '../../instruments/index.js';

const prefix = (str: string): string => 'documentTools_' + str;

type GetDocumentInput = Required<DocumentGetInput>;

type GetManyDocumentsInput = {
  documents: GetDocumentInput[];
};

const getDocumentInputSchema = z.object({
  documentId: z.string().describe('Document ID returned by a document-producing tool.'),
  format: z.enum(documentFormats).default('raw').describe(`How to format the returned content.
- For HTML, "raw", "slimHtml" and "html" are available
- For JSON, only "raw" is available.
- For text, only "raw" is available.

Guidelines:
  - For HTML, use "slimHtml" when it provides enough detail, to reduce context use.
`),
  transform: z.enum(documentTransforms).default('none')
    .describe(`Whether or not to collapse the content.
- For HTML, you can choose between "none" and "collapse'. Use transform "collapse" with HTML to collapse unexpanded page sections.
- For JSON, you can choose between "none" and "collapse'. Use transform "collapse" to reduce long arrays to their head and tail.
- For text, you can only choose "none"

Guidelines:
  - For HTML, use collapse when it provides enough detail, to reduce context use.
  - For JSON, use collapse when it provides enough detail, to reduce context use.
`),
});

const documentSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  origin: z.enum(documentOrigins),
  contentType: z.enum(documentContentTypes),
  status: z.number().int().nonnegative().nullable(),
  bytes: z.number().int().nonnegative(),
});

const documentSchema = documentSummarySchema.extend({
  headers: z.record(z.string(), z.string()),
  request: z.object({
    timestamp: z.string(),
    headers: z.record(z.string(), z.string()),
    proxy: z.string().nullable(),
    mode: z.enum(documentRequestModes),
  }),
  format: z.enum(documentFormats),
  transform: z.enum(documentTransforms),
  content: z.string(),
});

const requireDocument = (document: Document | null, documentId: DocumentId): Document => {
  if (!document) throw new Error(`Unknown document ID: ${documentId}`);
  return document;
};

export const executors: Record<string, any> = {
  listTool: async (query: DocumentListQuery) => ({
    documents: documentLibrary.list(query),
  }),
  getTool: async ({ documentId, format, transform }: GetDocumentInput) =>
    requireDocument(documentLibrary.get({ documentId, format, transform }), documentId),
  getManyTool: async ({ documents }: GetManyDocumentsInput) => ({
    documents: documentLibrary
      .getMany(documents)
      .map((document, index) => requireDocument(document, documents[index].documentId)),
  }),
};

const listTool = createTool({
  id: prefix('listTool'),
  description:
    'List saved documents and their metadata without returning document content. Browser navigation captures initial XHR/fetch JSON responses as dynamic documents, which you can list here.',
  inputSchema: z.object({
    documentIds: z.array(z.string()).optional(),
    origin: z
      .enum(documentOrigins)
      .optional()
      .describe('Use navigation for original page loads; use dynamic for XHR/fetch requests.'),
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

format:

transform:


  - For JSON, use collapse whenever it provides enough detail, to reduce context use.
`,
  inputSchema: getDocumentInputSchema,
  outputSchema: documentSchema,
  execute: executors.getTool,
});

const getManyTool = createTool({
  id: prefix('getManyTool'),
  description: 'Get multiple saved documents in selected formats and transforms.',
  inputSchema: z.object({
    documents: z.array(getDocumentInputSchema),
  }),
  outputSchema: z.object({
    documents: z.array(documentSchema),
  }),
  execute: executors.getManyTool,
});

const internal = [listTool, getTool, getManyTool];

export const createDocumentTools = async (): Promise<Record<string, Tool>> => {
  return Object.fromEntries(
    (await Promise.all(internal.map((tool) => addInstruments([runtimeInstrument], tool)))).map(
      (tool) => [tool.id, tool]
    )
  );
};

export const tools = await createDocumentTools();
