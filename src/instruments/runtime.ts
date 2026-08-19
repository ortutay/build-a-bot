import * as z from 'zod';
import { type Tool } from '@mastra/core/tools';
import { addMetric, instrumentOutputSchema } from './shared.js';

export const runtimeInstrument = async (tool: Tool): Promise<Tool> => {
  if (tool.outputSchema === undefined || tool.outputSchema == null) {
    return tool;
  }

  const runtimeOutputSchema = instrumentOutputSchema(
    tool.outputSchema,
    z.object({ runtime: z.number().describe('Runtime of this tool, in milliseconds.') })
  );

  return {
    ...tool,
    outputSchema: runtimeOutputSchema,
    execute: async (input, context) => {
      const start = new Date().getTime();
      let output;
      if (tool.execute) {
        output = await tool.execute(input, context);
      }
      const runtime = new Date().getTime() - start;
      // console.log('Tool runtime:', runtime, tool.id, context.agent?.toolCallId);
      return addMetric(output, 'runtime', runtime, tool, context);
    },
  };
};
