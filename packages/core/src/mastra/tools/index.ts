import type { GlobalContext } from '../../context/index.js';
import { close as closeBrightdataTools } from './brightdataTools/index.js';
import {
  close as closeBrowserTools,
  createTools as createBrowserTools,
  type CreateBrowserToolsOptions,
} from './browserTools/index.js';
import {
  close as closeCodeTools,
  createTools as createCodeTools,
  type CreateToolsOptions as CreateCodeToolsOptions,
} from './codeTools/index.js';
import {
  close as closeDocumentTools,
  createTools as createDocumentTools,
  type CreateDocumentToolsOptions,
} from './documents/index.js';
import {
  close as closeFetchTools,
  createTools as createFetchTools,
  type CreateFetchToolsOptions,
} from './fetchTools/index.js';
import { close as closeFirecrawlTools } from './firecrawlTools/index.js';
import { close as closeScrapingbeeTools } from './scrapingbeeTools/index.js';

export type CreateToolsOptions = CreateBrowserToolsOptions &
  CreateCodeToolsOptions &
  CreateDocumentToolsOptions &
  CreateFetchToolsOptions;

export const closeTools = async (context: GlobalContext): Promise<void> => {
  const results = await Promise.allSettled([
    closeBrightdataTools(context),
    closeBrowserTools(context),
    closeCodeTools(context),
    closeDocumentTools(context),
    closeFetchTools(context),
    closeFirecrawlTools(context),
    closeScrapingbeeTools(context),
  ]);
  const errors = results.filter((result) => result.status === 'rejected');
  if (errors.length) {
    throw new AggregateError(errors.map((result) => result.reason));
  }
};

export const createToolsSets = async (options: CreateToolsOptions) => {
  const [browserTools, codeTools, documentTools, fetchTools] = await Promise.all([
    createBrowserTools(options),
    createCodeTools(options),
    createDocumentTools(options),
    createFetchTools(options),
  ]);
  return {
    allTools: {
      ...fetchTools,
      ...browserTools,
      ...codeTools,
      ...documentTools,
    },
    fetchResearchTools: {
      ...fetchTools,
      ...codeTools,
      ...documentTools,
    },
    browserResearchTools: {
      ...browserTools,
      ...codeTools,
      ...documentTools,
    },
    planningTools: {
      ...fetchTools,
      ...browserTools,
      ...codeTools,
      ...documentTools,
    },
  };
};
