import './env.js';

export const env = process.env.ENV || 'dev';
export const deterministicRandom = env === 'test';
export const documentLibraryPath = process.env.DOCUMENT_LIBRARY_PATH;
export const isMastraPlatform = Boolean(process.env.MASTRA_PLATFORM_ACCESS_TOKEN);
export const redisCacheUrl = isMastraPlatform ? undefined : process.env.REDIS_CACHE_URL;
export const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL;
// Keep the environment lookup next to the local fallback so Mastra preflight
// can verify that production deployments supply a hosted database.
export const sqliteDbUrl = process.env.TURSO_DATABASE_URL ?? 'file:./db/mastra-storage.db';

export const openrouterApiKey = process.env.OPENROUTER_API_KEY;
export const openaiApiKey = process.env.OPENAI_API_KEY;
export const brightdataApiKey = process.env.BRIGHTDATA_API_KEY;
export const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
export const scrapingbeeApiKey = process.env.SCRAPINGBEE_API_KEY;
export const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;
