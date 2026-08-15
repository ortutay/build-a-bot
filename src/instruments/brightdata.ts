import { type Tool } from '@mastra/core/tools';
import { addMetric } from './shared.js';

export const brightdataCostInstrument = async (tool: Tool): Promise<Tool> => {
  const results = brightdataResults(tool.id);
  if (!results) {
    return tool;
  }

  return {
    ...tool,
    execute: async (input, context) => {
      let output;
      if (tool.execute) {
        output = await tool.execute(input, context);
      }

      const usedResults = results(input);
      const usd = {
        plans: Object.entries(brightdataPlanPrices).map(([name, price]) => ({
          name,
          usd: usedResults * price,
        })),
      };
      return addMetric(output, 'cost', { credits: usedResults, usd }, tool, context);
    },
  };
};

const brightdataPlanPrices = {
  free: 0,
  pay_as_you_go: 1.5 / 1_000,
  starter: 1.3 / 1_000,
  professional: 1.1 / 1_000,
  business: 1 / 1_000,
} as const;

const brightdataResults = (toolId: string): ((input: unknown) => number) | undefined => {
  if (toolId.startsWith('brightdata_web_data_')) {
    return () => 1;
  }

  switch (toolId) {
    case 'brightdata_search_engine':
    case 'brightdata_scrape_as_markdown':
    case 'brightdata_scrape_as_html':
    case 'brightdata_discover':
    case 'brightdata_extract':
      return () => 1;
    case 'brightdata_search_engine_batch':
      return (input) => items(input, 'queries');
    case 'brightdata_scrape_batch':
      return (input) => items(input, 'urls');
    default:
      return undefined;
  }
};

const items = (input: unknown, field: string): number => {
  if (typeof input !== 'object' || input === null || !(field in input)) {
    return 1;
  }
  const value = (input as Record<string, unknown>)[field];
  return Array.isArray(value) && value.length > 0 ? value.length : 1;
};
