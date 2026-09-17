import type { Mastra } from '@mastra/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Run } from '../../src/compile/Run.js';
import { Script } from '../../src/compile/Script.js';
import { GlobalContext } from '../../src/context/index.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/documents/index.js';
import { log } from '../../src/logger.js';
import { markAvailableTool } from '../../src/mastra/instruments/availableTools.js';
import { BrowserSession } from '../../src/mastra/tools/browserTools/BrowserSession.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { DataService } from '../../src/service/DataService.js';
import { DataSource } from '../../src/service/DataSource.js';
import { Item } from '../../src/service/Item.js';
import { dataSourcesTable, itemsTable, runsTable } from '../../src/storage/db/schema.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';
import { startMockDynamicJsonSite } from '../lib/mockDynamicJsonSite.js';

const scriptCode = `
  export const itemSchema = { type: 'object' };
  export const check = async (url) => true;
  export const uniqueId = (item) => JSON.stringify(item);
  export const run = async (url) => [];
`;

const invalidBuildScriptCode = `
  export const itemSchema = { type: 'object' };
  export const check = async (url) => true;
  export const run = async (url) => [];
`;

const syncScriptCode = `
  export const itemSchema = {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  };
  export const check = async (url) => true;
  export const uniqueId = (item) => item.value;
  export const run = async (url) => [{ value: 'scraped' }, { value: 'scraped' }];
`;

const invalidSyncScriptCode = `
  export const itemSchema = { type: 'object' };
  export const check = async (url) => true;
  export const uniqueId = (item) => item.value;
  export const run = async (url) => [{ value: 42 }];
`;

const emptySyncScriptCode = `
  export const itemSchema = { type: 'object' };
  export const check = async (url) => true;
  export const uniqueId = (item) => item.value;
  export const run = async (url) => [];
`;

const catalogSyncScriptCode = (url: string) => `
  export const itemSchema = { type: 'object' };
  export const check = async (url) => true;
  export const uniqueId = (item) => item.id;
  export const run = async (url) => {
    const catalog = await tools.fetchTool({ url: '${url}/api/catalog' });
    return catalog.products;
  };
`;

const groupedSyncScriptCode = (bot: string, pathPrefix: string, trace = false) => `
  export const itemSchema = {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  };
  export const uniqueId = (item) => item.value;
  export const check = async (url) => {
    ${trace ? `await tools.routeTrace({ bot: '${bot}', phase: 'check', url });` : ''}
    return new URL(url).pathname.startsWith('${pathPrefix}');
  };
  export const run = async (url) => {
    ${trace ? `await tools.routeTrace({ bot: '${bot}', phase: 'run', url });` : ''}
    return [{ value: '${bot}:' + new URL(url).pathname }];
  };
`;

const syncUrls = async (service: DataService, urls: string[]) => {
  return service.sync(urls);
};

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
              result: [{ code: scriptCode, groupingName: 'data-pages' }],
              status: 'success',
            };
          },
        }),
      }),
      listTools: () => ({ fetchTool }),
    } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const serviceContext = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary,
      mastra,
      storage,
    });
    const service = new DataService({
      context: serviceContext,
      name: 'example-service',
      sources: [new DataSource({ url: 'https://example.test/data' })],
      itemSchema: z.object({ value: z.string() }),
    });
    await service.build();
    const scripts = await Script.findActiveForDataService(await service.context(), service.id!);
    await service.build();
    const context = await service.context();

    const reused = await Script.findActiveForDataService(context, service.id!);
    expect(scripts).toHaveLength(1);
    expect(reused.map((script) => script.id)).toEqual(scripts.map((script) => script.id));
    expect(workflowRuns).toBe(1);
    expect(reused[0]).toMatchObject({
      buildInput: {
        goal: 'Build a scraper to get data in the output schema format.',
        urls: ['https://example.test/data'],
      },
      name: expect.stringMatching(/^script:[a-f0-9]{64}:[a-f0-9]{10}$/),
      dataServiceId: expect.any(String),
    });
    await expect(
      DataSource.findByUrl(context, service.id!, 'https://example.test/data')
    ).resolves.toMatchObject({
      id: expect.any(String),
    });
  });

  it('leaves an invalid active script for the heal workflow while preserving its history', async () => {
    temporaryDb = await createTemporaryDb();
    let workflowRuns = 0;
    const mastra = {
      getWorkflowById: () => ({
        createRun: async () => ({
          start: async () => {
            workflowRuns++;
            return {
              result: [{ code: scriptCode, groupingName: 'data-pages' }],
              status: 'success',
            };
          },
        }),
      }),
      listTools: () => ({}),
    } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const source = new DataSource({ url: 'https://example.test/data' });
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
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
    await service.build();
    const [invalidScript] = await Script.findActiveForDataService(context, service.id!);
    invalidScript.code = invalidBuildScriptCode;
    await invalidScript.save();
    const invalidScriptId = invalidScript.id;
    const run = new Run({ input: {}, scriptId: invalidScriptId! });
    await run.save(storage);
    await run.complete(storage);

    await service.build();

    const active = await Script.findActiveForDataService(context, service.id!);
    expect(workflowRuns).toBe(1);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ active: true, code: invalidBuildScriptCode });
    expect(active[0].id).toBe(invalidScriptId);
    await expect(storage.db.select().from(runsTable)).resolves.toHaveLength(1);
  });

  it('activates an unchecked replacement and retains stored items', async () => {
    temporaryDb = await createTemporaryDb();
    const start = vi.fn().mockResolvedValue({
      status: 'success',
      result: [{ code: syncScriptCode, groupingName: 'data' }],
    });
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      storage: temporaryDb.storage,
      mastra: {
        getWorkflowById: () => ({ createRun: async () => ({ start }) }),
        listTools: () => ({}),
      } as unknown as Mastra,
    });
    const url = 'https://example.test/data';
    const service = new DataService({
      context,
      name: 'validate-before-activation',
      sources: [new DataSource({ url })],
      itemSchema: z.object({ value: z.string() }),
    });
    await service.build();
    await service.sync([url]);
    const [active] = await Script.findActiveForDataService(context, service.id!);
    active.name = 'previous-build';
    await active.save();
    const before = await temporaryDb.storage.db.select().from(itemsTable);
    start.mockResolvedValue({
      status: 'success',
      result: [
        {
          code: syncScriptCode.replace('async (url) => true', 'async (url) => false'),
          groupingName: 'data',
        },
      ],
    });
    await service.build();
    expect(
      (await Script.findActiveForDataService(context, service.id!)).map((script) => script.id)
    ).not.toEqual([active.id]);
    expect(await temporaryDb.storage.db.select().from(itemsTable)).toEqual(before);
    expect(await temporaryDb.storage.db.select().from(runsTable)).toHaveLength(1);
  });

  it('lists items from active and inactive scripts, including totals and pagination', async () => {
    temporaryDb = await createTemporaryDb();
    const storage = temporaryDb.storage;
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      mastra: {} as Mastra,
      storage,
    });
    const service = new DataService({
      context,
      name: 'active-items',
      sources: [],
      itemSchema: z.object({ value: z.string() }),
    });
    await service.save();

    for (const active of [false, true]) {
      const script = new Script({
        context,
        active,
        dataServiceId: service.id!,
        name: 'source',
        code: scriptCode,
        modules: [],
        tools: [],
        vmContext: [],
      });
      await script.save();
      for (const uniqueId of active ? ['b', 'c'] : ['a', 'd']) {
        await new Item({
          data: { value: active ? 'current' : 'historical' },
          sourceUrl: 'https://example.test/data',
          sourceScriptId: script.id!,
          uniqueId,
        }).save(storage);
      }
    }

    await expect(service.list()).resolves.toEqual({
      count: 4,
      total: 4,
      results: [
        { id: 'a', value: 'historical' },
        { id: 'b', value: 'current' },
        { id: 'c', value: 'current' },
        { id: 'd', value: 'historical' },
      ],
    });
    await expect(service.list({ limit: 1, page: 2 })).resolves.toEqual({
      count: 1,
      total: 4,
      results: [{ id: 'b', value: 'current' }],
    });
    await expect(storage.db.select().from(itemsTable)).resolves.toHaveLength(4);
  });

  it('lists and gets current items scoped to the service', async () => {
    temporaryDb = await createTemporaryDb();
    const storage = temporaryDb.storage;
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
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
      sourceUrl: source.url,
      sourceScriptId: script.id!,
      uniqueId: 'scraped',
    }).save(storage);
    await new Item({
      data: { value: 'second' },
      sourceUrl: source.url,
      sourceScriptId: script.id!,
      uniqueId: 'second',
    }).save(storage);
    await new Item({
      data: { value: 'other' },
      sourceUrl: otherSource.url,
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
      sourceUrl: duplicateSource.url,
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

  it('deduplicates extracted items and persists runs and items', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const source = new DataSource({ url: 'https://example.test/data' });
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary,
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

    const result = await service.sync([source.url]);

    expect(result).toMatchObject({
      created: [{ data: { value: 'scraped' } }],
      updated: [],
      outcome: { success: [{ url: source.url }], unhandled: [], errors: [] },
    });
    const [dataSource] = await storage.db.select().from(dataSourcesTable);
    const [run] = await storage.db.select().from(runsTable);
    const [item] = await storage.db.select().from(itemsTable);

    expect(dataSource).toMatchObject({ url: source.url });
    expect(run).toMatchObject({
      input: { url: source.url },
      scriptId: script.id,
      status: 'done',
    });
    expect(item).toMatchObject({
      createdAt: expect.any(String),
      data: { value: 'scraped' },
      sourceUrl: source.url,
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
      const proxyRegistry = new ProxyRegistry([new NoProxy()]);
      const context = new GlobalContext({
        browserSession: new BrowserSession(proxyRegistry),
        proxyRegistry,
        documentLibrary,
        mastra,
        storage,
      });
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

      await service.sync([source.url]);
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

      await service.sync([source.url]);

      const runs = await storage.db.select().from(runsTable);
      const items = await storage.db.select().from(itemsTable).orderBy(itemsTable.uniqueId);

      expect(runs).toHaveLength(2);
      expect(items).toMatchObject([
        { data: { id: 'json-gadget', name: 'JSON Gadget', price: 36 }, uniqueId: 'json-gadget' },
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
      expect(items.map((item) => item.sourceScriptId)).toEqual([
        script.id,
        script.id,
        script.id,
        script.id,
      ]);
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
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary,
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

    await expect(service.sync([source.url])).resolves.toEqual({
      created: [],
      updated: [],
      outcome: {
        success: [],
        unhandled: [],
        errors: [{ url: source.url, error: expect.any(String) }],
      },
    });

    const [run] = await storage.db.select().from(runsTable);
    expect(run).toMatchObject({
      error: { message: expect.any(String), name: 'ZodError' },
      status: 'error',
    });
  });

  it('completes an empty run and retains previously seen items', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const source = new DataSource({ url: 'https://example.test/data' });
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary,
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
    const script = new Script({
      context: await service.context(),
      dataServiceId: service.id!,
      name: `url:${source.url}`,
      code: emptySyncScriptCode,
      modules: [],
      tools: [],
      vmContext: [],
    });
    await script.save();

    await new Item({
      data: { value: 'stale' },
      sourceUrl: source.url,
      sourceScriptId: script.id!,
      uniqueId: 'stale',
    }).save(storage);
    const result = await service.sync([source.url]);

    expect(result).toMatchObject({
      created: [],
      updated: [],
      outcome: { success: [{ url: source.url }], unhandled: [], errors: [] },
    });
    const runs = await storage.db.select().from(runsTable);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ input: { url: source.url }, status: 'done' });
    await expect(storage.db.select().from(itemsTable)).resolves.toMatchObject([
      { data: { value: 'stale' } },
    ]);
  });

  it('allows the same data source URL for multiple services', async () => {
    temporaryDb = await createTemporaryDb();
    const storage = temporaryDb.storage;
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
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

  it('builds separate scripts for page groups and routes each URL to its matching bot', async () => {
    temporaryDb = await createTemporaryDb();
    const urls = [
      'https://example.test/catalog/widget',
      'https://example.test/people/ada-lovelace',
    ];
    const routeTrace = vi.fn(async () => ({}));
    const routeTraceTool = await markAvailableTool({ id: 'routeTrace', execute: routeTrace });
    const workflowStart = vi.fn(async () => ({
      result: [
        {
          groupingName: 'catalog-pages',
          code: groupedSyncScriptCode('catalog', '/catalog/', true),
        },
        {
          groupingName: 'people-pages',
          code: groupedSyncScriptCode('people', '/people/', true),
        },
      ],
      status: 'success',
    }));
    const mastra = {
      getWorkflowById: () => ({ createRun: async () => ({ start: workflowStart }) }),
      listTools: () => ({ routeTrace: routeTraceTool }),
    } as unknown as Mastra;
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      mastra,
      storage: temporaryDb.storage,
    });
    const service = new DataService({
      context,
      itemSchema: z.object({ value: z.string() }),
      name: 'example-service',
      sources: urls.map((url) => new DataSource({ url })),
    });

    await service.build();
    await expect(syncUrls(service, urls)).resolves.toMatchObject({
      created: [
        { data: { value: 'catalog:/catalog/widget' } },
        { data: { value: 'people:/people/ada-lovelace' } },
      ],
      updated: [],
      outcome: { success: urls.map((url) => ({ url })), unhandled: [], errors: [] },
    });

    expect(workflowStart).toHaveBeenCalledOnce();
    for (const url of urls) {
      expect(routeTrace).toHaveBeenCalledWith({ bot: 'catalog', phase: 'check', url });
      expect(routeTrace).toHaveBeenCalledWith({ bot: 'people', phase: 'check', url });
    }
    expect(routeTrace).toHaveBeenCalledWith({
      bot: 'catalog',
      phase: 'run',
      url: urls[0],
    });
    expect(routeTrace).toHaveBeenCalledWith({
      bot: 'people',
      phase: 'run',
      url: urls[1],
    });
    await expect(temporaryDb.storage.db.select().from(runsTable)).resolves.toHaveLength(2);
    await expect(temporaryDb.storage.db.select().from(itemsTable)).resolves.toHaveLength(2);
  });

  it('defers ambiguous seed routing validation until healing', async () => {
    temporaryDb = await createTemporaryDb();
    const url = 'https://example.test/catalog/widget';
    const workflowStart = vi.fn(async () => ({
      result: [
        {
          groupingName: 'first-catalog-pages',
          code: groupedSyncScriptCode('first', '/catalog/'),
        },
        {
          groupingName: 'second-catalog-pages',
          code: groupedSyncScriptCode('second', '/catalog/'),
        },
      ],
      status: 'success',
    }));
    const mastra = {
      getWorkflowById: () => ({ createRun: async () => ({ start: workflowStart }) }),
      listTools: () => ({}),
    } as unknown as Mastra;
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      mastra,
      storage: temporaryDb.storage,
    });
    const service = new DataService({
      context,
      itemSchema: z.object({ value: z.string() }),
      name: 'example-service',
      sources: [new DataSource({ url })],
    });

    await expect(service.build()).resolves.toBeUndefined();
    await expect(Script.findActiveForDataService(context, service.id!)).resolves.toHaveLength(2);
    await expect(temporaryDb.storage.db.select().from(runsTable)).resolves.toEqual([]);
  });

  it('reports URLs that no active bot can handle', async () => {
    temporaryDb = await createTemporaryDb();
    const sourceUrl = 'https://example.test/catalog/widget';
    const unhandledUrl = 'https://example.test/people/ada-lovelace';
    const workflowStart = vi.fn(async () => ({
      result: [
        {
          groupingName: 'catalog-pages',
          code: groupedSyncScriptCode('catalog', '/catalog/'),
        },
      ],
      status: 'success',
    }));
    const mastra = {
      getWorkflowById: () => ({ createRun: async () => ({ start: workflowStart }) }),
      listTools: () => ({}),
    } as unknown as Mastra;
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      mastra,
      storage: temporaryDb.storage,
    });
    const service = new DataService({
      context,
      itemSchema: z.object({ value: z.string() }),
      name: 'example-service',
      sources: [new DataSource({ url: sourceUrl })],
    });

    await service.build();

    await expect(syncUrls(service, [unhandledUrl])).resolves.toEqual({
      created: [],
      updated: [],
      outcome: { success: [], unhandled: [{ url: unhandledUrl }], errors: [] },
    });
    await expect(temporaryDb.storage.db.select().from(runsTable)).resolves.toEqual([]);
  });

  it('reports an unhandled URL when a source has no saved script', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
      documentLibrary,
      mastra,
      storage,
    });
    const service = new DataService({
      context,
      name: 'example-service',
      sources: [new DataSource({ url: 'https://example.test/missing' })],
      itemSchema: z.object({ value: z.string() }),
    });

    await expect(service.sync(['https://example.test/missing'])).resolves.toEqual({
      created: [],
      updated: [],
      outcome: { success: [], unhandled: [{ url: 'https://example.test/missing' }], errors: [] },
    });
  });
});
