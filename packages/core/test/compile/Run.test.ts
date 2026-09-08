import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GlobalContext } from '../../src/context/index.js';
import { Bot } from '../../src/internal/bot/Bot.js';
import { Run } from '../../src/internal/compile/Run.js';
import { Script } from '../../src/internal/compile/Script.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/internal/documents/index.js';
import { DataService } from '../../src/service/DataService.js';
import { resultsTable, runsTable } from '../../src/storage/db/schema.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

describe('Run', () => {
  let temporaryDb: TemporaryDb | null = null;

  afterEach(async () => {
    await temporaryDb?.dispose();
    temporaryDb = null;
  });

  it('persists a Bot run and its results', async () => {
    temporaryDb = await createTemporaryDb();
    const storage = temporaryDb.storage;
    const context = new GlobalContext({
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      mastra: {} as never,
      storage,
    });
    const service = new DataService({
      context,
      itemSchema: z.object({}),
      name: 'example-service',
      sources: [],
    });
    await service.save();
    const script = new Script({
      context,
      dataServiceId: service.id!,
      name: 'example-script',
      code: '',
      modules: [],
      tools: [],
      vmContext: [],
    });
    await script.save();
    const input = { query: 'example' };
    const bot = new Bot({
      exampleInput: input,
      fn: async () => ({ logs: [], out: [{ value: 'scraped' }] }),
      inputSchema: { type: 'object' },
      outputSchema: { type: 'array' },
      uniqueId: (item) => (item as { value: string }).value,
    });
    const run = new Run({ scriptId: script.id!, input });

    await run.save(storage);
    const output = await bot.run(input);
    await run.complete(storage, output as unknown[]);

    const [storedRun] = await storage.db.select().from(runsTable);
    const [storedResult] = await storage.db.select().from(resultsTable);

    expect(storedRun).toMatchObject({
      input,
      scriptId: script.id,
      status: 'done',
    });
    expect(storedResult.id).toHaveLength(10);
    expect(storedResult).toMatchObject({ data: { value: 'scraped' }, runId: storedRun.id });
  });
});
