import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import { Compiler, availableModules, availableContext } from '../../../compile/Compiler.js';
import {
  documentLibrary,
  type DocumentGetInput,
  type DocumentId,
  type DocumentListQuery,
} from '../../../documents/index.js';

const prefix = (str: string): string => 'codeTools_' + str;

const snippetContext = {
  values: {
    documentLibrary: {
      list: (query?: DocumentListQuery) => documentLibrary.list(query),
      get: (input: DocumentGetInput) => documentLibrary.get(input),
      getMany: (inputs: DocumentGetInput[]) => documentLibrary.getMany(inputs),
      summary: (documentId: DocumentId) => documentLibrary.summary(documentId),
    },
  },
  documentation: `
Document library:

The read-only \`documentLibrary\` contains documents saved by the fetch and browser tools. Do not import it.

- \`documentLibrary.list(query?)\` returns document summaries. Filter with \`documentIds\`, \`origin\`, \`contentType\`, or \`urlPrefix\`.
- \`documentLibrary.get({ documentId, format?, transform? })\` returns a document or \`null\`. Use \`format: 'slimHtml'\` and \`transform: 'collapse'\` to reduce HTML when appropriate.
- \`documentLibrary.getMany(inputs)\` returns documents or \`null\` entries for missing IDs.
- \`documentLibrary.summary(documentId)\` returns a document summary or \`null\`.
`,
};

const runJsSnippetTool = createTool({
  id: prefix('runJsSnippetTool'),
  description: `Runs a JavaScript code snippet.

You have the following modules available. They will already be loaded into the VM context, do not import them: ${JSON.stringify(Object.keys(availableModules))}

You also have the following symbols available in the context. Do not rely on any other symbols: ${JSON.stringify(
    [...Object.keys(availableContext), ...Object.keys(snippetContext.values)]
  )}
${snippetContext.documentation}

You should define a function called run as follows:

  export const run = async () => {
    return ...
  }

- Your code should take no inputs, and return whatever you need for your inspection.
- Depending on your goals, use either the document library or modules to get page content. Generally, if you are testing selectors, you'll want to pull from the known good documents in document library. If you are testing reachability or accessability, then use the modules.
- Keep your snippets short and to the point.
`,
  inputSchema: z.object({
    intent: z.string().describe('Briefly describe what you intend to test with this snippet'),
    code: z.string().describe('JavaScript code snippet to run. It will be a run in a VM context.'),
  }),
  outputSchema: z.unknown().describe('The return value of the code snippet'),
  execute: async ({ code }, context) => {
    const agentId = context.agent?.agentId;
    if (!context.mastra || !agentId) {
      throw new Error('runJsSnippetTool must be called by an agent.');
    }

    const compiler = new Compiler();
    const { fn } = await compiler.compile(
      `
        const inputSchema = { type: 'object', additionalProperties: false };
        const outputSchema = {};
        ${code}
      `,
      { additionalContext: snippetContext.values }
    );

    return fn({});
  },
});

const internal = [runJsSnippetTool];

export const tools = Object.fromEntries(internal.map((tool) => [tool.id, tool]));
