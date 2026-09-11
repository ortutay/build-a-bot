import type { Mastra } from '@mastra/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Run } from '../../src/compile/Run.js';
import { Script } from '../../src/compile/Script.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/documents/index.js';
import { log } from '../../src/logger.js';
import { markAvailableTool } from '../../src/mastra/instruments/availableTools.js';
import { DataSource } from '../../src/service/DataSource.js';
import { DataService, ScriptNotFoundError } from '../../src/service/DataService.js';
import { Item } from '../../src/service/Item.js';
import { GlobalContext } from '../../src/context/index.js';
import { hash } from '../../src/util/index.js';
import {
  dataSourcesTable,
  itemsTable,
  resultsTable,
  runsTable,
} from '../../src/storage/db/schema.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';
import { startMockDynamicJsonSite } from '../lib/mockDynamicJsonSite.js';

const scriptCode = `
  export const inputSchema = { type: 'object' };
  export const outputSchema = { type: 'object' };
  export const exampleInput = {};
  export const uniqueId = (item) => JSON.stringify(item);
  export const run = async () => ({});
`;

const invalidBuildScriptCode = `
  export const inputSchema = { type: 'object' };
  export const outputSchema = { type: 'object' };
  export const exampleInput = {};
  export const run = async () => ({});
`;

const syncScriptCode = `
  export const inputSchema = { type: 'object' };
  export const outputSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
      },
      count: { type: 'number' },
      total: { type: 'number' },
    },
    required: ['results', 'count', 'total'],
  };
  export const exampleInput = {};
  export const uniqueId = (item) => item.value;
  export const run = async () => ({
    results: [{ value: 'scraped' }, { value: 'scraped' }],
    count: 2,
    total: 2,
  });
`;

const invalidSyncScriptCode = `
  export const inputSchema = { type: 'object' };
  export const outputSchema = { type: 'object' };
  export const exampleInput = {};
  export const uniqueId = (item) => item.value;
  export const run = async () => ({ results: [{ value: 'scraped' }], count: 2, total: 1 });
`;

const pagedSyncScriptCode = `
  export const inputSchema = { type: 'object' };
  export const outputSchema = { type: 'object' };
  export const exampleInput = {};
  export const uniqueId = (item) => item.value;
  export const run = async ({ offset }) => {
    if (offset === 0) {
      return {
        results: Array.from({ length: 100 }, (_, index) => ({ value: String(index) })),
        count: 100,
        total: 200,
      };
    }

    return { results: [], count: 0, total: 200 };
  };
`;

const catalogSyncScriptCode = (url: string) => `
  export const inputSchema = { type: 'object' };
  export const outputSchema = { type: 'object' };
  export const exampleInput = {};
  export const uniqueId = (item) => item.id;
  export const run = async ({ limit, offset }) => {
    const catalog = await tools.fetchTool({ url: '${url}/api/catalog' });
    const results = catalog.products.slice(offset, offset + limit);
    return { results, count: results.length, total: catalog.products.length };
  };
`;

describe('DataService', () => {
  let temporaryDb: TemporaryDb | null = null;

  afterEach(async () => {
    await temporaryDb?.dispose();
    temporaryDb = null;
  });

  it('generates and saves a script once, then reuses it for the same source', async () => {
    temporaryDb = await createTemporaryDb();
    let workflowRuns = 0;
    const fetchTool = await markAvailableTool({ id: 'fetchTool', execute: async () => ({}) });
    const mastra = {
      getWorkflowById: () => ({
        createRun: async () => ({
          start: async () => {
            workflowRuns++;
            return {
              result: { code: scriptCode, urls: ['https://example.test/data'] },
              status: 'success',
            };
          },
        }),
      }),
      listTools: () => ({ fetchTool }),
    } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const serviceContext = new GlobalContext({ documentLibrary, mastra, storage });
    const service = new DataService({
      context: serviceContext,
      name: 'example-service',
      sources: [new DataSource({ url: 'https://example.test/data' })],
      itemSchema: z.object({ value: z.string() }),
    });
    await service.build();
    await service.build();
    const context = await service.context();

    const scriptName = `urls:${hash({ urls: ['https://example.test/data'] })}`;
    const script = await Script.findByName(context, service.id!, scriptName);
    expect(workflowRuns).toBe(1);
    expect(script).toMatchObject({
      buildInput: {
        goal: 'Build a scraper to get data in the output schema format.',
        urls: ['https://example.test/data'],
      },
      name: scriptName,
      dataServiceId: expect.any(String),
    });
    await expect(
      DataSource.findByUrl(context, service.id!, 'https://example.test/data')
    ).resolves.toMatchObject({
      id: expect.any(String),
    });
  });

  it('regenerates an invalid saved script in place on the second attempt', async () => {
    temporaryDb = await createTemporaryDb();
    let workflowRuns = 0;
    const mastra = {
      getWorkflowById: () => ({
        createRun: async () => ({
          start: async () => {
            workflowRuns++;
            return {
              result: { code: scriptCode, urls: ['https://example.test/data'] },
              status: 'success',
            };
          },
        }),
      }),
      listTools: () => ({}),
    } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const source = new DataSource({ url: 'https://example.test/data' });
    const context = new GlobalContext({
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      mastra,
      storage,
    });
    const service = new DataService({
      context,
      name: 'example-service',
      sources: [source],
      itemSchema: z.object({ value: z.string() }),
    });
    await service.save();
    const invalidScript = new Script({
      context: await service.context(),
      dataServiceId: service.id!,
      name: `urls:${hash({ urls: [source.url] })}`,
      code: invalidBuildScriptCode,
      buildInput: {
        goal: 'Build a scraper to get data in the output schema format.',
        urls: [source.url],
      },
      modules: [],
      tools: [],
      vmContext: [],
    });
    await invalidScript.save();
    const invalidScriptId = invalidScript.id;
    const run = new Run({ input: {}, scriptId: invalidScriptId! });
    await run.save(storage);
    await run.complete(storage, [{ value: 'historical' }]);

    await service.build();

    const recoveredScript = await Script.findByName(
      await service.context(),
      service.id!,
      invalidScript.name
    );
    expect(workflowRuns).toBe(1);
    expect(recoveredScript).toMatchObject({ code: scriptCode });
    expect(recoveredScript?.id).toBe(invalidScriptId);
    await expect(storage.db.select().from(runsTable)).resolves.toHaveLength(1);
    await expect(storage.db.select().from(resultsTable)).resolves.toHaveLength(1);
  });

  it('lists and gets current items scoped to the service', async () => {
    temporaryDb = await createTemporaryDb();
    const storage = temporaryDb.storage;
    const context = new GlobalContext({
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      mastra: {} as Mastra,
      storage,
    });
    const service = new DataService({
      context,
      name: 'example-service',
      sources: [],
      itemSchema: z.object({ value: z.string() }),
    });
    const otherService = new DataService({
      context,
      name: 'other-service',
      sources: [],
      itemSchema: z.object({ value: z.string() }),
    });
    await service.save();
    await otherService.save();

    const script = new Script({
      context,
      dataServiceId: service.id!,
      name: 'source',
      code: scriptCode,
      modules: [],
      tools: [],
      vmContext: [],
    });
    const otherScript = new Script({
      context,
      dataServiceId: otherService.id!,
      name: 'source',
      code: scriptCode,
      modules: [],
      tools: [],
      vmContext: [],
    });
    await script.save();
    await otherScript.save();
    const source = new DataSource({
      context,
      dataServiceId: service.id!,
      url: 'https://example.test/data',
    });
    const otherSource = new DataSource({
      context,
      dataServiceId: otherService.id!,
      url: 'https://other.test/data',
    });
    await source.save();
    await otherSource.save();
    await new Item({
      data: { value: 'scraped' },
      dataSourceId: source.id!,
      sourceScriptId: script.id!,
      uniqueId: 'scraped',
    }).save(storage);
    await new Item({
      data: { value: 'second' },
      dataSourceId: source.id!,
      sourceScriptId: script.id!,
      uniqueId: 'second',
    }).save(storage);
    await new Item({
      data: { value: 'other' },
      dataSourceId: otherSource.id!,
      sourceScriptId: otherScript.id!,
      uniqueId: 'other',
    }).save(storage);

    await expect(service.list({ limit: 1, page: 2 })).resolves.toEqual({
      count: 1,
      total: 2,
      results: [{ id: 'second', value: 'second' }],
    });
    await expect(service.detail('scraped')).resolves.toEqual({ value: 'scraped' });

    const duplicateScript = new Script({
      context,
      dataServiceId: service.id!,
      name: 'second-source',
      code: scriptCode,
      modules: [],
      tools: [],
      vmContext: [],
    });
    const duplicateSource = new DataSource({
      context,
      dataServiceId: service.id!,
      url: 'https://second.example.test/data',
    });
    await duplicateScript.save();
    await duplicateSource.save();
    await new Item({
      data: { value: 'duplicate' },
      dataSourceId: duplicateSource.id!,
      sourceScriptId: duplicateScript.id!,
      uniqueId: 'scraped',
    }).save(storage);

    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    await expect(service.detail('scraped')).resolves.toMatchObject({ value: expect.any(String) });
    expect(warn).toHaveBeenCalledWith(
      'Multiple items found for service=example-service, uniqueId=scraped; returning the first result'
    );
    warn.mockRestore();
    await expect(service.detail('missing')).resolves.toBeNull();
  });

  it('deduplicates and persists DataService results, runs, and current items', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const source = new DataSource({ url: 'https://example.test/data' });
    const context = new GlobalContext({ documentLibrary, mastra, storage });
    const service = new DataService({
      context,
      name: 'example-service',
      sources: [source],
      itemSchema: z.object({ value: z.string() }),
    });
    await service.save();
    const script = new Script({
      context: await service.context(),
      dataServiceId: service.id!,
      name: `url:${source.url}`,
      code: syncScriptCode,
      modules: [],
      tools: [],
      vmContext: [],
    });
    await script.save();

    const result = await service.sync();

    expect(result).toEqual({ results: [{ value: 'scraped' }] });
    const [dataSource] = await storage.db.select().from(dataSourcesTable);
    const [run] = await storage.db.select().from(runsTable);
    const [storedResult] = await storage.db
      .select()
      .from(resultsTable)
      .where(eq(resultsTable.runId, run.id));
    const [item] = await storage.db.select().from(itemsTable);

    expect(dataSource).toMatchObject({ url: source.url });
    expect(run).toMatchObject({
      input: { limit: 100, offset: 0 },
      scriptId: script.id,
      status: 'done',
    });
    await expect(storage.db.select().from(resultsTable)).resolves.toHaveLength(1);
    expect(storedResult).toMatchObject({ data: { value: 'scraped' }, runId: run.id });
    expect(item).toMatchObject({
      createdAt: expect.any(String),
      data: { value: 'scraped' },
      dataSourceId: source.id,
      sourceScriptId: script.id,
      uniqueId: 'scraped',
      updatedAt: expect.any(String),
    });
  });

  it('reconciles current items after the source catalog changes', async () => {
    temporaryDb = await createTemporaryDb();
    const site = await startMockDynamicJsonSite();
    try {
      const storage = temporaryDb.storage;
      const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
      const fetchTool = await markAvailableTool({
        id: 'fetchTool',
        execute: async () => fetch(`${site.baseUrl}/api/catalog`).then((resp) => resp.json()),
      });
      const mastra = { listTools: () => ({ fetchTool }) } as unknown as Mastra;
      const source = new DataSource({ url: site.baseUrl });
      const context = new GlobalContext({ documentLibrary, mastra, storage });
      const service = new DataService({
        context,
        name: 'catalog-service',
        sources: [source],
        itemSchema: z.object({ id: z.string(), name: z.string(), price: z.number() }),
      });
      await service.save();
      const script = new Script({
        context: await service.context(),
        dataServiceId: service.id!,
        name: `url:${source.url}`,
        code: catalogSyncScriptCode(site.baseUrl),
        modules: [],
        tools: ['fetchTool'],
        vmContext: [],
      });
      await script.save();

      site.setProducts([
        { id: 'json-widget', name: 'JSON Widget', price: 24 },
        { id: 'json-gadget', name: 'JSON Gadget', price: 36 },
      ]);

      await service.sync();
      expect(await storage.db.select().from(itemsTable).orderBy(itemsTable.uniqueId)).toMatchObject(
        [
          { data: { id: 'json-gadget', name: 'JSON Gadget', price: 36 }, uniqueId: 'json-gadget' },
          { data: { id: 'json-widget', name: 'JSON Widget', price: 24 }, uniqueId: 'json-widget' },
        ]
      );

      site.setProducts([
        { id: 'json-widget', name: 'JSON Widget Plus', price: 28 },
        { id: 'json-new', name: 'JSON New Product', price: 42 },
        { id: 'json-other', name: 'JSON Other Product', price: 64 },
      ]);

      await service.sync();

      const runs = await storage.db.select().from(runsTable);
      const results = await storage.db.select().from(resultsTable);
      const items = await storage.db.select().from(itemsTable).orderBy(itemsTable.uniqueId);

      expect(runs).toHaveLength(2);
      expect(results).toHaveLength(5);
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            data: { id: 'json-gadget', name: 'JSON Gadget', price: 36 },
          }),
          expect.objectContaining({
            data: { id: 'json-widget', name: 'JSON Widget', price: 24 },
          }),
          expect.objectContaining({
            data: { id: 'json-new', name: 'JSON New Product', price: 42 },
          }),
          expect.objectContaining({
            data: { id: 'json-other', name: 'JSON Other Product', price: 64 },
          }),
          expect.objectContaining({
            data: { id: 'json-widget', name: 'JSON Widget Plus', price: 28 },
          }),
        ])
      );
      expect(items).toMatchObject([
        { data: { id: 'json-new', name: 'JSON New Product', price: 42 }, uniqueId: 'json-new' },
        {
          data: { id: 'json-other', name: 'JSON Other Product', price: 64 },
          uniqueId: 'json-other',
        },
        {
          data: { id: 'json-widget', name: 'JSON Widget Plus', price: 28 },
          uniqueId: 'json-widget',
        },
      ]);
      expect(items.map((item) => item.sourceScriptId)).toEqual([script.id, script.id, script.id]);
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            createdAt: expect.any(String),
            sourceScriptId: script.id,
            updatedAt: expect.any(String),
          }),
        ])
      );
    } finally {
      await site.close();
    }
  });

  it('marks a run as errored when bot output is invalid', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const source = new DataSource({ url: 'https://example.test/data' });
    const context = new GlobalContext({ documentLibrary, mastra, storage });
    const service = new DataService({
      context,
      name: 'example-service',
      sources: [source],
      itemSchema: z.object({ value: z.string() }),
    });
    await service.save();
    const script = new Script({
      context: await service.context(),
      dataServiceId: service.id!,
      name: `url:${source.url}`,
      code: invalidSyncScriptCode,
      modules: [],
      tools: [],
      vmContext: [],
    });
    await script.save();

    await expect(service.sync()).rejects.toBeInstanceOf(z.ZodError);

    const [run] = await storage.db.select().from(runsTable);
    expect(run).toMatchObject({
      error: { message: expect.any(String), name: 'ZodError' },
      status: 'error',
    });
    await expect(storage.db.select().from(resultsTable)).resolves.toEqual([]);
  });

  it('stops paginating after an empty page', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const source = new DataSource({ url: 'https://example.test/data' });
    const context = new GlobalContext({ documentLibrary, mastra, storage });
    const service = new DataService({
      context,
      name: 'example-service',
      sources: [source],
      itemSchema: z.object({ value: z.string() }),
    });
    await service.save();
    const script = new Script({
      context: await service.context(),
      dataServiceId: service.id!,
      name: `url:${source.url}`,
      code: pagedSyncScriptCode,
      modules: [],
      tools: [],
      vmContext: [],
    });
    await script.save();

    const result = await service.sync();

    expect(result.results).toHaveLength(100);
    await expect(storage.db.select().from(runsTable)).resolves.toHaveLength(2);
    await expect(storage.db.select().from(resultsTable)).resolves.toHaveLength(100);
  });

  it('allows the same data source URL for multiple services', async () => {
    temporaryDb = await createTemporaryDb();
    const storage = temporaryDb.storage;
    const context = new GlobalContext({
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      mastra: {} as Mastra,
      storage,
    });
    const first = new DataService({
      context,
      itemSchema: z.object({}),
      name: 'first-service',
      sources: [new DataSource({ url: 'https://example.test/data' })],
    });
    const second = new DataService({
      context,
      itemSchema: z.object({}),
      name: 'second-service',
      sources: [new DataSource({ url: 'https://example.test/data' })],
    });

    await first.save();
    await second.save();

    expect(second.sources[0]!.id).not.toBe(first.sources[0]!.id);
    await expect(storage.db.select().from(dataSourcesTable)).resolves.toHaveLength(2);
  });

  it('reports a named error when a source has no saved script', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const context = new GlobalContext({ documentLibrary, mastra, storage });
    const service = new DataService({
      context,
      name: 'example-service',
      sources: [new DataSource({ url: 'https://example.test/missing' })],
      itemSchema: z.object({ value: z.string() }),
    });

    await expect(service.sync()).rejects.toBeInstanceOf(ScriptNotFoundError);
  });
});
