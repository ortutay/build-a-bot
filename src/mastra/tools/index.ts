import { tools as fetchTools } from './fetchTools/index.js';
import { tools as browserTools } from './browserTools/index.js';
import { tools as codeTools } from './codeTools/index.js';
import { tools as documentTools } from './documents/index.js';
import { createTools as createBrightdataTools } from './brightdataTools/index.js';
// import { createTools as createFirecrawlTools } from './firecrawlTools/index.js';
import { createTools as createScrapingbeeTools } from './scrapingbeeTools/index.js';

export const allTools = {
  ...fetchTools,
  ...browserTools,
  ...codeTools,
  ...documentTools,
  // ...brightdataTools,
  // ...firecrawlTools,
  // ...scrapingbeeTools,
};
export const fetchResearchTools = {
  ...fetchTools,
  ...codeTools,
  ...documentTools,
};
export const browserResearchTools = {
  ...browserTools,
  ...codeTools,
  ...documentTools,
};

export const planningTools = {
  ...fetchTools,
  ...browserTools,
  ...codeTools,
  ...documentTools,
};
