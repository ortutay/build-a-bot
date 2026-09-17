import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Bot } from '../../src/bot/Bot.js';
import { Run } from '../../src/compile/Run.js';
import { Script } from '../../src/compile/Script.js';
import { GlobalContext } from '../../src/context/index.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/documents/index.js';
import { BrowserSession } from '../../src/mastra/tools/browserTools/BrowserSession.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { DataService } from '../../src/service/DataService.js';
import { runsTable } from '../../src/storage/db/schema.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

describe('Run', () => {
  let temporaryDb: TemporaryDb | null = null;

  afterEach(async () => {
    await temporaryDb?.dispose();
    temporaryDb = null;
  });

  it('persists Bot run status and timestamps', async () => {
    temporaryDb = await createTemporaryDb();
    const storage = temporaryDb.storage;
    const proxyRegistry = new ProxyRegistry([new NoProxy()]);
    const context = new GlobalContext({
      browserSession: new BrowserSession(proxyRegistry),
      proxyRegistry,
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
    const input = { url: 'https://example.test/data' };
    const output = [{ value: 'scraped' }];
    const logs = [['scraped one item']];
    const bot = new Bot({
      check: async () => ({ logs: [], out: true }),
      run: async () => ({ logs, out: output }),
      itemSchema: { type: 'object', properties: { value: { type: 'string' } } },
      uniqueId: (item) => (item as { value: string }).value,
    });
    const run = new Run({ scriptId: script.id!, input });

    await run.save(storage);
    await expect(bot.check(input.url)).resolves.toBe(true);
    await expect(bot.run(input.url, run.id!)).resolves.toEqual(output);
    expect(bot.getLogs(run.id!)).toEqual(logs);
    await run.complete(storage);

    const [storedRun] = await storage.db.select().from(runsTable);

    expect(storedRun).toMatchObject({
      input,
      scriptId: script.id,
      status: 'done',
      endTime: expect.any(String),
    });
  });
});
