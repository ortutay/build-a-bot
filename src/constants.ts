import './env.js';

export const env = process.env.ENV || 'dev';
export const deterministicRandom = env === 'test';
export const documentLibraryPath = process.env.DOCUMENT_LIBRARY_PATH;
export const isMastraPlatform = Boolean(process.env.MASTRA_PLATFORM_ACCESS_TOKEN);
export const redisCacheUrl = process.env.REDIS_CACHE_URL;
export const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL;

export const duckDbUrl = './db/mastra-duckdb.db';

export const openrouterApiKey = process.env.OPENROUTER_API_KEY;
export const openaiApiKey = process.env.OPENAI_API_KEY;
export const brightdataApiKey = process.env.BRIGHTDATA_API_KEY;
export const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
export const scrapingbeeApiKey = process.env.SCRAPINGBEE_API_KEY;
export const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;
