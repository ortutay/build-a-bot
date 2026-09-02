import type { Mastra } from '@mastra/core';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Script } from '../../src/internal/compile/Script.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/internal/documents/index.js';
import { markAvailableTool } from '../../src/internal/mastra/instruments/availableTools.js';
import { DataSource } from '../../src/source/DataSource.js';
import { DataService, ScriptNotFoundError } from '../../src/service/DataService.js';
import type { ServiceContext } from '../../src/service/Service.js';
import { dataSourcesTable, resultsTable, runsTable } from '../../src/storage/db/schema.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

const scriptCode = `
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
  export const run = async () => ({ results: [{ value: 'scraped' }], count: 1, total: 1 });
`;

const invalidSyncScriptCode = `
  export const inputSchema = { type: 'object' };
  export const outputSchema = { type: 'object' };
  export const exampleInput = {};
  export const run = async () => ({ results: [{ value: 'scraped' }], count: 2, total: 1 });
`;

const pagedSyncScriptCode = `
  export const inputSchema = { type: 'object' };
  export const outputSchema = { type: 'object' };
  export const exampleInput = {};
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
            return { result: { code: scriptCode }, status: 'success' };
          },
        }),
      }),
      listTools: () => ({ fetchTool }),
    } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const app = express();
    const service = new DataService({
      name: 'example-service',
      sources: [new DataSource({ url: 'https://example.test/data' })],
      itemSchema: z.object({ value: z.string() }),
      mastra,
      storage,
      documentLibrary,
    });
    const context: ServiceContext = { app, documentLibrary, mastra, storage };

    await service._build(context);
    await service._build(context);

    const script = await Script.findByName(
      temporaryDb.storage,
      service.name,
      'url:https://example.test/data'
    );
    expect(workflowRuns).toBe(1);
    expect(script).toMatchObject({
      buildInput: {
        goal: 'Build a scraper to get data in the output schema format.',
        url: 'https://example.test/data',
      },
      name: 'url:https://example.test/data',
      serviceId: expect.any(String),
    });
    await expect(DataSource.findByUrl(storage, 'https://example.test/data')).resolves.toMatchObject(
      {
        id: expect.any(String),
      }
    );
  });

  it('adds a health endpoint for the service', async () => {
    const app = { get: vi.fn() };
    const service = new DataService({
      name: 'example-service',
      sources: [],
      itemSchema: z.object({}),
    });

    await service._run({ app } as unknown as ServiceContext);

    expect(app.get).toHaveBeenCalledWith('/example-service/health', expect.any(Function));

    const handler = app.get.mock.calls[0][1] as (
      req: unknown,
      resp: { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> }
    ) => void;
    const resp = { json: vi.fn(), status: vi.fn() };
    resp.status.mockReturnValue(resp);

    handler({}, resp);

    expect(resp.status).toHaveBeenCalledWith(200);
    expect(resp.json).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('syncs a DataService and persists its run and results', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const source = new DataSource({ url: 'https://example.test/data' });
    const service = new DataService({
      name: 'example-service',
      sources: [source],
      itemSchema: z.object({ value: z.string() }),
      mastra,
      storage,
      documentLibrary,
    });
    const script = new Script({
      name: `url:${source.url}`,
      code: syncScriptCode,
      context: [],
      modules: [],
      tools: [],
    });
    await script.save(storage, service.name);

    const result = await service.sync();

    expect(result).toEqual({ results: [{ value: 'scraped' }] });
    const [dataSource] = await storage.db.select().from(dataSourcesTable);
    const [run] = await storage.db.select().from(runsTable);
    const [storedResult] = await storage.db
      .select()
      .from(resultsTable)
      .where(eq(resultsTable.runId, run.id));

    expect(dataSource).toMatchObject({ url: source.url });
    expect(run).toMatchObject({
      input: { limit: 100, offset: 0 },
      scriptId: script.id,
      status: 'done',
    });
    expect(storedResult).toMatchObject({ data: { value: 'scraped' }, runId: run.id });
  });

  it('marks a run as errored when bot output is invalid', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const source = new DataSource({ url: 'https://example.test/data' });
    const service = new DataService({
      name: 'example-service',
      sources: [source],
      itemSchema: z.object({ value: z.string() }),
      mastra,
      storage,
      documentLibrary,
    });
    const script = new Script({
      name: `url:${source.url}`,
      code: invalidSyncScriptCode,
      context: [],
      modules: [],
      tools: [],
    });
    await script.save(storage, service.name);

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
    const service = new DataService({
      name: 'example-service',
      sources: [source],
      itemSchema: z.object({ value: z.string() }),
      mastra,
      storage,
      documentLibrary,
    });
    const script = new Script({
      name: `url:${source.url}`,
      code: pagedSyncScriptCode,
      context: [],
      modules: [],
      tools: [],
    });
    await script.save(storage, service.name);

    const result = await service.sync();

    expect(result.results).toHaveLength(100);
    await expect(storage.db.select().from(runsTable)).resolves.toHaveLength(2);
    await expect(storage.db.select().from(resultsTable)).resolves.toHaveLength(100);
  });

  it('reuses a data source for multiple services', async () => {
    temporaryDb = await createTemporaryDb();
    const first = new DataSource({ url: 'https://example.test/data' });
    const second = new DataSource({ url: 'https://example.test/data' });

    await first.save(temporaryDb.storage);
    await second.save(temporaryDb.storage);

    expect(second.id).toBe(first.id);
    await expect(temporaryDb.storage.db.select().from(dataSourcesTable)).resolves.toHaveLength(1);
  });

  it('reports a named error when a source has no saved script', async () => {
    temporaryDb = await createTemporaryDb();
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const service = new DataService({
      name: 'example-service',
      sources: [new DataSource({ url: 'https://example.test/missing' })],
      itemSchema: z.object({ value: z.string() }),
      mastra,
      storage,
      documentLibrary,
    });

    await expect(service.sync()).rejects.toBeInstanceOf(ScriptNotFoundError);
  });
});
