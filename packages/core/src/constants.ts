import './env.js';

export const env = process.env.ENV || 'dev';
export const deterministicRandom = env === 'test';
export const documentLibraryPath = process.env.DOCUMENT_LIBRARY_PATH;
export const isMastraPlatform = Boolean(process.env.MASTRA_PLATFORM_ACCESS_TOKEN);
export const redisCacheUrl = process.env.REDIS_CACHE_URL;
export const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL;
export const mastraDatabaseFilepath = 'file:./.build-a-bot/mastra.db';
export const storageDirectory = '.build-a-bot';
export const storageDatabasePath = `${storageDirectory}/data.db`;
export const storageDatabaseFilepath = `file:./${storageDatabasePath}`;
// Bump this when a squashed schema requires local storage to be recreated.
export const storageSchemaVersion = '1';

export const openrouterApiKey = process.env.OPENROUTER_API_KEY;
export const openaiApiKey = process.env.OPENAI_API_KEY;
export const brightdataApiKey = process.env.BRIGHTDATA_API_KEY;
export const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
export const proxyDatacenterDedicatedPassword = process.env.PROXY_DATACENTER_DEDICATED_PASSWORD;
export const proxyDatacenterDedicatedServer = process.env.PROXY_DATACENTER_DEDICATED_SERVER;
export const proxyDatacenterDedicatedUsername = process.env.PROXY_DATACENTER_DEDICATED_USERNAME;
export const proxyDatacenterSharedPassword = process.env.PROXY_DATACENTER_SHARED_PASSWORD;
export const proxyDatacenterSharedServer = process.env.PROXY_DATACENTER_SHARED_SERVER;
export const proxyDatacenterSharedUsername = process.env.PROXY_DATACENTER_SHARED_USERNAME;
export const proxyResidentialCdpUrl = process.env.PROXY_RESIDENTIAL_CDP_URL;
export const proxyResidentialPassword = process.env.PROXY_RESIDENTIAL_PASSWORD;
export const proxyResidentialServer = process.env.PROXY_RESIDENTIAL_SERVER;
export const proxyResidentialUsername = process.env.PROXY_RESIDENTIAL_USERNAME;
export const proxyUnblockApiUrl = process.env.PROXY_UNBLOCK_API_URL;
export const proxyUnblockToken = process.env.PROXY_UNBLOCK_TOKEN;
export const proxyUnblockZone = process.env.PROXY_UNBLOCK_ZONE;
export const scrapingbeeApiKey = process.env.SCRAPINGBEE_API_KEY;
export const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;
