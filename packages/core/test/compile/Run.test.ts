import { afterEach, describe, expect, it } from 'vitest';
import { Bot } from '../../src/internal/bot/Bot.js';
import { Run } from '../../src/internal/compile/Run.js';
import { Script } from '../../src/internal/compile/Script.js';
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
    const script = new Script({
      name: 'example-script',
      code: '',
      context: [],
      modules: [],
      tools: [],
    });
    await script.save(storage, 'example-service');
    const input = { query: 'example' };
    const bot = new Bot({
      exampleInput: input,
      fn: async () => ({ logs: [], out: [{ value: 'scraped' }] }),
      inputSchema: { type: 'object' },
      outputSchema: { type: 'array' },
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
