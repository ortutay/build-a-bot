import { type Tool } from '@mastra/core/tools';
import { addMetric } from './shared.js';

export const runtimeInstrument = async (tool: Tool): Promise<Tool> => {
  return {
    ...tool,
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
