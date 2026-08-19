import './env.js';

export const env = process.env.ENV || 'dev';
export const deterministicRandom = env === 'test';

export const openrouterApiKey = process.env.OPENROUTER_API_KEY;
export const openaiApiKey = process.env.OPENAI_API_KEY;
export const brightdataApiKey = process.env.BRIGHTDATA_API_KEY;
export const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
export const scrapingbeeApiKey = process.env.SCRAPINGBEE_API_KEY;
