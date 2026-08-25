import type { Dataset } from '@mastra/core/datasets';
import { z } from 'zod';
import { log } from '../logger.js';
import { mastra } from '../mastra/index.js';
import { getOrNull } from '../util/index.js';
import { basicTargets, realEstateTargets } from './targets.js';

const realEstateDatasetName = 'real-estate';
const basicDatasetName = 'basic';

type Target = {
  url: string;
  goal: string;
  inputSchema: z.ZodType;
  outputSchema?: z.ZodType;
  exampleInput?: unknown;
};

const datasetItemInputSchema = z.object({
  url: z.string(),
  goal: z.string(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  exampleInput: z.object({}).passthrough().optional(),
});

class DatasetNotFoundError extends Error {
  constructor(name: string) {
    super(`Dataset ${name} was not found`);
    this.name = 'DatasetNotFoundError';
  }
}

export const loadDataset = async (name: string): Promise<Dataset> => {
  const existing = await mastra.datasets.list({ filters: { name } });
  const datasets = existing.datasets.filter((dataset) => dataset.name === name);
  if (datasets.length === 0) {
    throw new DatasetNotFoundError(name);
  }
  if (datasets.length > 1) {
    throw new Error(`Multiple datasets found for name ${name}`);
  }

  const dataset = datasets[0];
  if (!dataset) {
    throw new DatasetNotFoundError(name);
  }

  return mastra.datasets.get({ id: dataset.id });
};

export const loadItemsFromDataset = async (name: string, { limit }: { limit: number }) => {
  const dataset = await loadDataset(name);
  const result = await dataset.listItems({ page: 0, perPage: limit });
  return Array.isArray(result) ? result : result.items;
};

const createDatasetIfNotExists = async (name: string, description: string) => {
  let dataset: Dataset;
  try {
    dataset = await loadDataset(name);

    const details = await dataset.getDetails();
    const inputSchema = z.toJSONSchema(datasetItemInputSchema);
    if (JSON.stringify(details.inputSchema) !== JSON.stringify(inputSchema)) {
      await dataset.update({ inputSchema: datasetItemInputSchema });
      log.info(`Updated dataset input schema: id=${dataset.id}, name=${name}`);
    }
  } catch (e) {
    if (!(e instanceof DatasetNotFoundError)) {
      throw e;
    }

    dataset = await mastra.datasets.create({
      name,
      description,
      inputSchema: datasetItemInputSchema,
    });
  }

  log.info(`Using dataset: id=${dataset.id}, name=${name}`);
  return dataset;
};

export const createRealEstateIfNotExists = async () =>
  createDatasetIfNotExists(realEstateDatasetName, 'Real-estate scraping targets');

export const createBasicIfNotExists = async () =>
  createDatasetIfNotExists(basicDatasetName, 'Basic scraping targets');

const existingItemsByUrl = async (dataset: Dataset) => {
  const existing = new Map<string, Awaited<ReturnType<typeof dataset.getItem>>>();
  for (let page = 0; ; page += 1) {
    const result = await dataset.listItems({ page, perPage: 100 });
    const items = Array.isArray(result) ? result : result.items;
    for (const item of items) {
      const url = getOrNull<string>(item.input, 'url');
      if (url) {
        if (existing.has(url)) {
          throw new Error(`Multiple dataset items found for URL ${url}`);
        }
        existing.set(url, item);
      }
    }

    if (Array.isArray(result) || !result.pagination.hasMore) {
      return existing;
    }
  }
};

const upsertTargets = async (dataset: Dataset, name: string, targets: Target[]) => {
  const existing = await existingItemsByUrl(dataset);
  const items = [];
  const updates = [];

  for (const { url, goal, inputSchema, outputSchema, exampleInput } of targets) {
    const input = {
      url,
      goal,
      inputSchema: z.toJSONSchema(inputSchema),
      ...(outputSchema === undefined ? {} : { outputSchema: z.toJSONSchema(outputSchema) }),
      ...(exampleInput === undefined ? {} : { exampleInput }),
    };
    const item = existing.get(url);
    if (!item) {
      items.push({ externalId: url, input });
    } else if (JSON.stringify(item.input) !== JSON.stringify(input)) {
      updates.push({ itemId: item.id, input });
    }
  }

  if (items.length === 0 && updates.length === 0) {
    log.info(`${name} dataset is already up to date`);
    return;
  }

  if (items.length > 0) {
    await dataset.addItems({ items });
    log.info(`Added ${items.length} ${name} target${items.length === 1 ? '' : 's'}`);
  }

  for (const update of updates) {
    await dataset.updateItem(update);
  }
  if (updates.length > 0) {
    log.info(`Updated ${updates.length} ${name} target${updates.length === 1 ? '' : 's'}`);
  }
};

export const upsertRealEstate = async (dataset: Dataset) =>
  upsertTargets(dataset, 'real-estate', realEstateTargets);

export const upsertBasic = async (dataset: Dataset) =>
  upsertTargets(dataset, 'basic', basicTargets);
