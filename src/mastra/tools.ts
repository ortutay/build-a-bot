import { tools as fetchTools } from '../tools/fetchTools/index.js';
import { tools as browserTools } from '../tools/browserTools/index.js';
import { tools as codeTools } from '../tools/codeTools/index.js';
import { tools as documentTools } from '../tools/documents/index.js';
import { createTools as createBrightdataTools } from '../tools/brightdataTools/index.js';
// import { createTools as createFirecrawlTools } from '../tools/firecrawlTools/index.js';
import { createTools as createScrapingbeeTools } from '../tools/scrapingbeeTools/index.js';

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
