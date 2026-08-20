import { type Tool } from '@mastra/core/tools';
import { memo } from 'radash';
import { z } from 'zod';
import { scrapingbeeApiKey } from '../../constants.js';
import { addMetric, instrumentOutputSchema } from '../../instruments/shared.js';
import { getOrNull } from '../../util/index.js';

export const scrapingbeeCostInstrument = async (tool: Tool): Promise<Tool> => {
  const credits = scrapingbeeCredits(tool.id);
  if (!credits || tool.outputSchema === undefined || tool.outputSchema === null) {
    return tool;
  }

  return {
    ...tool,
    outputSchema: instrumentOutputSchema(tool.outputSchema, z.object({ cost: z.unknown() })),
    execute: async (input, context) => {
      let output;
      if (tool.execute) {
        output = await tool.execute(input, context);
      }

      const usedCredits = credits(input);
      const pricePerCredit = await getScrapingbeePricePerCredit();
      const usd = {
        plans: Object.entries(scrapingbeePlanPrices).map(([name, price]) => ({
          name,
          usd: usedCredits * price,
        })),
        ...(pricePerCredit === undefined ? {} : { charged: usedCredits * pricePerCredit }),
      };
      return addMetric(output, 'cost', { credits: usedCredits, usd }, tool, context);
    },
  };
};

const scrapingbeePlanPrices = {
  free: 0,
  freelance: 49 / 250_000,
  startup: 99 / 1_000_000,
  business: 249 / 3_000_000,
  business_plus: 599 / 1_000_000,
} as const;

const scrapingbeePriceByPlanCredits = new Map<number, number>([
  [1_000, scrapingbeePlanPrices.free],
  [250_000, scrapingbeePlanPrices.freelance],
  [1_000_000, scrapingbeePlanPrices.startup],
  [3_000_000, scrapingbeePlanPrices.business],
  [8_000_000, scrapingbeePlanPrices.business_plus],
]);

const getScrapingbeePricePerCredit = memo(async (): Promise<number | undefined> => {
  if (!scrapingbeeApiKey) {
    return undefined;
  }
  try {
    const resp = await fetch('https://app.scrapingbee.com/api/v1/usage', {
      headers: { Authorization: `Bearer ${scrapingbeeApiKey}` },
    });
    if (!resp.ok) {
      return undefined;
    }
    const body: unknown = await resp.json();
    const planCredits = getPlanCredits(body);
    return planCredits === undefined ? undefined : scrapingbeePriceByPlanCredits.get(planCredits);
  } catch (e) {
    return undefined;
  }
});

const getPlanCredits = (body: unknown): number | undefined =>
  getOrNull<number>(body, 'max_api_credit') ?? undefined;

const scrapingbeeCredits = (toolId: string): ((input: unknown) => number) | undefined => {
  switch (toolId) {
    case 'scrapingbee_get_page_text':
    case 'scrapingbee_get_page_html':
    case 'scrapingbee_extract_page_data':
      return htmlCredits;
    case 'scrapingbee_get_screenshot':
      return (input) => htmlCredits({ ...asRecord(input), render_js: true });
    case 'scrapingbee_get_file':
      return (input) => (isEnabled(input, 'premium_proxy') ? 10 : 1);
    case 'scrapingbee_fast_search':
      return () => 10;
    case 'scrapingbee_get_google_search_results':
      return (input) => pages(input) * (isEnabled(input, 'light_request') ? 10 : 15);
    case 'scrapingbee_get_amazon_search_results':
      return (input) => pages(input) * (isEnabled(input, 'light_request') ? 5 : 15);
    case 'scrapingbee_get_amazon_product_details':
      return (input) => (isEnabled(input, 'light_request') ? 5 : 15);
    case 'scrapingbee_get_walmart_search_results':
    case 'scrapingbee_get_walmart_product_details':
      return (input) => (isEnabled(input, 'light_request') ? 10 : 15);
    case 'scrapingbee_get_youtube_search_results':
    case 'scrapingbee_get_youtube_video_metadata':
      return () => 15;
    case 'scrapingbee_ask_chatgpt':
      return () => 15;
    default:
      return undefined;
  }
};

const htmlCredits = (input: unknown): number => {
  const credits = isEnabled(input, 'stealth_proxy')
    ? 75
    : isEnabled(input, 'premium_proxy')
      ? isEnabled(input, 'render_js')
        ? 25
        : 10
      : isEnabled(input, 'render_js')
        ? 5
        : 1;
  return credits + (hasValue(input, 'ai_query') ? 5 : 0);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const isEnabled = (input: unknown, field: string): boolean => asRecord(input)[field] === true;

const hasValue = (input: unknown, field: string): boolean => {
  const value = asRecord(input)[field];
  return typeof value === 'string' && value.length > 0;
};

const pages = (input: unknown): number => {
  const value = asRecord(input).pages;
  return typeof value === 'number' && value > 0 ? value : 1;
};
