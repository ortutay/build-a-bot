import { createTool, type Tool } from '@mastra/core/tools';
import { z } from 'zod';
import { Compiler, availableModules, availableContext } from '../../compile/Compiler.js';

const prefix = (str: string): string => 'codeTools_' + str;

const runJsSnippetTool = createTool({
  id: prefix('runJsSnippetTool'),
  description: `Runs a JavaScript code snippet.

You have the following modules available. They will already be loaded into the VM context, do not import them: ${JSON.stringify(Object.keys(availableModules))}

You also have the following symbols available in the context. Do not rely on any other symbols: ${JSON.stringify(Object.keys(availableContext))}

You should define a function called run as follows:

  export const run = async () => {
    return ...
  }

Your code should take no inputs, and return whatever you need for your inspection.
Keep your snippets short and to the point.
`,
  inputSchema: z.object({
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
      context.mastra.getAgentById(agentId)
    );

    return fn({});
  },
});

const internal = [runJsSnippetTool];

export const tools = Object.fromEntries(internal.map((tool) => [tool.id, tool]));
