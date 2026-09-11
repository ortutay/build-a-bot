import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GlobalContext } from '../../src/context/index.js';
import { Bot } from '../../src/bot/Bot.js';
import { Run } from '../../src/compile/Run.js';
import { Script } from '../../src/compile/Script.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/documents/index.js';
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
    const input = { urls: ['https://example.test/data'] };
    const output = { results: [{ value: 'scraped' }], urlsVisited: input.urls };
    const logs = [['scraped one item']];
    const bot = new Bot({
      check: async (urls) => ({ logs: [], out: urls.map(() => true) }),
      run: async () => ({ logs, out: output }),
      outputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      uniqueId: (item) => (item as { value: string }).value,
    });
    const run = new Run({ scriptId: script.id!, input });

    await run.save(storage);
    await expect(bot.check(input.urls)).resolves.toEqual([true]);
    await expect(bot.run(input.urls, run.id!)).resolves.toEqual(output);
    expect(bot.getLogs(run.id!)).toEqual(logs);
    await run.complete(storage, output.results);

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
