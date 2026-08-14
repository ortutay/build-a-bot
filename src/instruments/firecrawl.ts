import { type Tool } from '@mastra/core/tools';
import { memo } from 'radash';
import { firecrawlApiKey } from '../constants.js';
import { addMetric } from './shared.js';

export const firecrawlCostInstrument = async (tool: Tool): Promise<Tool> => {
  const credits = firecrawlCredits(tool.id);
  if (!credits) {
    return tool;
  }

  return {
    ...tool,
    execute: async (input, context) => {
      let output;
      if (tool.execute) {
        output = await tool.execute(input, context);
      }

      const usedCredits = credits(input);
      const pricePerCredit = await getFirecrawlPricePerCredit();
      const usd = {
        plans: Object.entries(firecrawlPlanPrices).map(([name, price]) => ({
          name,
          usd: usedCredits * price,
        })),
        ...(pricePerCredit === undefined ? {} : { charged: usedCredits * pricePerCredit }),
      };
      return addMetric(output, 'cost', { credits: usedCredits, usd }, tool, context);
    },
  };
};

const firecrawlPlanPrices = {
  free: 0,
  hobby: 16 / 5_000,
  standard: 83 / 100_000,
  growth: 333 / 500_000,
  scale: 599 / 1_000_000,
} as const;

const firecrawlPriceByPlanCredits = new Map<number, number>([
  [1_000, firecrawlPlanPrices.free],
  [5_000, firecrawlPlanPrices.hobby],
  [100_000, firecrawlPlanPrices.standard],
  [500_000, firecrawlPlanPrices.growth],
  [1_000_000, firecrawlPlanPrices.scale],
]);

const getFirecrawlPricePerCredit = memo(async (): Promise<number | undefined> => {
  if (!firecrawlApiKey) {
    return undefined;
  }
  try {
    const resp = await fetch('https://api.firecrawl.dev/v2/team/credit-usage', {
      headers: { Authorization: `Bearer ${firecrawlApiKey}` },
    });
    if (!resp.ok) {
      return undefined;
    }
    const body: unknown = await resp.json();
    const planCredits = getPlanCredits(body);
    return planCredits === undefined ? undefined : firecrawlPriceByPlanCredits.get(planCredits);
  } catch (e) {
    return undefined;
  }
});

const getPlanCredits = (body: unknown): number | undefined => {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return undefined;
  }
  const data = body.data;
  if (typeof data !== 'object' || data === null || !('planCredits' in data)) {
    return undefined;
  }
  return typeof data.planCredits === 'number' ? data.planCredits : undefined;
};

const firecrawlCredits = (toolId: string): ((input: unknown) => number) | undefined => {
  switch (toolId) {
    case 'firecrawl_firecrawl_scrape':
      return (input) => (hasJsonFormat(input) ? 5 : 1);
    case 'firecrawl_firecrawl_map':
      return () => 1;
    case 'firecrawl_firecrawl_crawl':
      return (input) => getCrawlLimit(input) ?? 10_000;
    default:
      return undefined;
  }
};

const hasJsonFormat = (input: unknown): boolean => {
  if (typeof input !== 'object' || input === null || !('formats' in input)) {
    return false;
  }
  const formats = input.formats;
  return (
    Array.isArray(formats) &&
    formats.some(
      (format) =>
        format === 'json' ||
        (typeof format === 'object' &&
          format !== null &&
          'type' in format &&
          format.type === 'json')
    )
  );
};

const getCrawlLimit = (input: unknown): number | undefined => {
  if (typeof input !== 'object' || input === null || !('limit' in input)) {
    return undefined;
  }
  return typeof input.limit === 'number' ? input.limit : undefined;
};
