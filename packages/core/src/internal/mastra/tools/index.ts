import { tools as codeTools } from './codeTools/index.js';
import {
  createTools as createBrowserTools,
  type CreateBrowserToolsOptions,
} from './browserTools/index.js';
import {
  createTools as createDocumentTools,
  type CreateDocumentToolsOptions,
} from './documents/index.js';
import {
  createTools as createFetchTools,
  type CreateFetchToolsOptions,
} from './fetchTools/index.js';

export type CreateToolsOptions = CreateBrowserToolsOptions &
  CreateDocumentToolsOptions &
  CreateFetchToolsOptions;

export const createToolsSets = async (options: CreateToolsOptions) => {
  const [browserTools, documentTools, fetchTools] = await Promise.all([
    createBrowserTools(options),
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
