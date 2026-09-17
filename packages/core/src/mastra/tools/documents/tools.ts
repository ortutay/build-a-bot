import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import type { GlobalContext } from '../../../context/index.js';
import {
  documentContentTypes,
  documentFormats,
  documentOrigins,
  documentRequestModes,
  documentTransforms,
  type Document,
  type DocumentGetInput,
  type DocumentId,
  type DocumentListQuery,
  type DocumentLibrary,
  type DocumentSummary,
} from '../../../documents/index.js';
import { addInstruments, markAvailableTool, runtimeInstrument } from '../../instruments/index.js';

const prefix = (str: string): string => 'documentTools_' + str;

export const close = async (_context: GlobalContext): Promise<void> => {};

type GetDocumentInput = z.input<typeof getDocumentInputSchema>;

type GetManyDocumentsInput = z.input<typeof getManyInputSchema>;

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
}) satisfies z.ZodType<DocumentGetInput>;

const documentSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  origin: z.enum(documentOrigins),
  contentType: z.enum(documentContentTypes),
  status: z.number().int().nonnegative().nullable(),
  bytes: z.number().int().nonnegative(),
}) satisfies z.ZodType<DocumentSummary>;

const documentSchema = documentSummarySchema.extend({
  headers: z.record(z.string(), z.string()),
  request: z.object({
    cursorId: z.string().optional(),
    captureId: z.string().optional(),
    method: z.string().optional(),
    body: z.string().nullable().optional(),
    frameUrl: z.string().nullable().optional(),
    timestamp: z.string(),
    headers: z.record(z.string(), z.string()),
    proxy: z.string().nullable(),
    mode: z.enum(documentRequestModes),
  }),
  format: z.enum(documentFormats),
  transform: z.enum(documentTransforms),
  content: z.string(),
}) satisfies z.ZodType<Document>;

const listInputSchema = z.object({
  captureId: z.string().optional().describe('Scope to a browserTools_networkTool captureId'),
  documentIds: z.array(z.string()).optional(),
  origin: z
    .enum(documentOrigins)
    .optional()
    .describe('Use navigation for original page loads; use dynamic for XHR/fetch requests.'),
  contentType: z.enum(documentContentTypes).optional(),
  urlPrefix: z.string().optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().nonnegative().max(50).optional(),
}) satisfies z.ZodType<DocumentListQuery>;

const listOutputSchema = z.object({
  documents: z.array(documentSummarySchema),
});

const getManyInputSchema = z.object({
  documents: z.array(getDocumentInputSchema),
});

const getManyOutputSchema = z.object({
  documents: z.array(documentSchema),
});

const requireDocument = (document: Document | null, documentId: DocumentId): Document => {
  if (!document) throw new Error(`Unknown document ID: ${documentId}`);
  return document;
};

export const executors: Record<string, any> = {
  listTool: async (
    documentLibrary: DocumentLibrary,
    query: DocumentListQuery
  ): Promise<z.infer<typeof listOutputSchema>> => ({
    documents: documentLibrary.list(query),
  }),
  getTool: async (
    documentLibrary: DocumentLibrary,
    { documentId, format, transform }: GetDocumentInput
  ): Promise<Document> =>
    requireDocument(documentLibrary.get({ documentId, format, transform }), documentId),
  getManyTool: async (
    documentLibrary: DocumentLibrary,
    { documents }: GetManyDocumentsInput
  ): Promise<z.infer<typeof getManyOutputSchema>> => ({
    documents: documentLibrary
      .getMany(documents)
      .map((document, index) => requireDocument(document, documents[index].documentId)),
  }),
};

const createListTool = (documentLibrary: DocumentLibrary): any => {
  const tool = createTool({
    id: prefix('listTool'),
    description:
      'List saved documents and their metadata without returning document content. Browser navigation captures initial XHR/fetch JSON responses as dynamic documents, which you can list here.',
    inputSchema: listInputSchema,
    outputSchema: listOutputSchema,
    execute: (...args) => executors.listTool(documentLibrary, ...args),
  });
  return tool;
};

const createGetTool = (documentLibrary: DocumentLibrary): any =>
  createTool({
    id: prefix('getTool'),
    description: `Get a saved document in a selected format and transform.

format:

transform:


  - For JSON, use collapse whenever it provides enough detail, to reduce context use.
`,
    inputSchema: getDocumentInputSchema,
    outputSchema: documentSchema,
    execute: (...args) => executors.getTool(documentLibrary, ...args),
  });

const createGetManyTool = (documentLibrary: DocumentLibrary): any =>
  createTool({
    id: prefix('getManyTool'),
    description: 'Get multiple saved documents in selected formats and transforms.',
    inputSchema: getManyInputSchema,
    outputSchema: getManyOutputSchema,
    execute: (...args) => executors.getManyTool(documentLibrary, ...args),
  });

export type CreateDocumentToolsOptions = {
  documentLibrary: DocumentLibrary;
};

export const createTools = async (
  options: CreateDocumentToolsOptions
): Promise<Record<string, Tool>> => {
  const listTool = createListTool(options.documentLibrary);
  const getTool = createGetTool(options.documentLibrary);
  const getManyTool = createGetManyTool(options.documentLibrary);
  const internal = [listTool, getTool, getManyTool];
  return Object.fromEntries(
    (
      await Promise.all(
        internal.map((tool) => addInstruments([runtimeInstrument, markAvailableTool], tool))
      )
    ).map((tool) => [tool.id, tool])
  );
};
