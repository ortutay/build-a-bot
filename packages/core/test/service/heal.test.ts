import { Mastra } from '@mastra/core/mastra';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Script } from '../../src/compile/Script.js';
import { GlobalContext } from '../../src/context/index.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/documents/index.js';
import { BrowserSession } from '../../src/mastra/tools/browserTools/BrowserSession.js';
import { healWorkflow } from '../../src/mastra/workflows/index.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { DataService } from '../../src/service/DataService.js';
import { DataSource } from '../../src/service/DataSource.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

vi.mock('../../src/mastra/create.js', () => ({ defaultMastra: vi.fn() }));

let db: TemporaryDb;
afterEach(async () => {
  vi.restoreAllMocks();
  await db?.dispose();
});

it('persists dependency-only healing and skips saving an unchanged script', async () => {
  db = await createTemporaryDb();
  const mastra = new Mastra({ workflows: { healWorkflow }, logger: false });
  const generate = vi.fn().mockResolvedValue({
    object: {
      code: null,
      confidence: 100,
      noChanges: true,
      rating: 100,
      report: 'The code is correct.',
    },
  });
  vi.spyOn(mastra, 'getAgentById').mockReturnValue({ generate } as any);
  const proxyRegistry = new ProxyRegistry([new NoProxy()]);
  const context = new GlobalContext({
    browserSession: new BrowserSession(proxyRegistry),
    documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
    mastra,
    proxyRegistry,
    storage: db.storage,
  });
  const url = 'https://example.test/items';
  const service = new DataService({
    context,
    itemSchema: z.object({ id: z.string() }),
    name: 'dependency-healing',
    sources: [new DataSource({ url })],
  });
  await service.save();
  const code = `export const itemSchema = { type: 'object' };
export const uniqueId = item => item.id;
export const check = async url => true;
export const run = async url => [{ id: 'correct' }];`;
  const script = new Script({
    context,
    code,
    dataServiceId: service.id!,
    modules: ['zod', 'missing-module'],
    name: 'dependency-healing-script',
    tools: ['missing-tool'],
    vmContext: ['URL', 'missing-context'],
  });
  await script.save();
  await expect(script.compile()).rejects.toThrow('Script dependency is not available');
  const save = vi.spyOn(Script.prototype, 'save');

  await service.heal();

  expect(save).toHaveBeenCalledOnce();
  const healed = await Script.findById(context, script.id!);
  expect(healed).toMatchObject({
    code,
    modules: ['zod'],
    tools: [],
    vmContext: ['URL'],
  });
  const bot = await healed!.compile();
  await expect(bot.run(url)).resolves.toEqual([{ id: 'correct' }]);

  save.mockClear();
  await service.heal();
  expect(save).not.toHaveBeenCalled();
});

it('serializes a queued heal after build completes', async () => {
  db = await createTemporaryDb();
  let finishBuild!: (val: unknown) => void;
  const buildStart = vi.fn(
    () =>
      new Promise((resolve) => {
        finishBuild = resolve;
      })
  );
  const healStart = vi.fn().mockResolvedValue({
    result: {
      code: null,
      context: [],
      modules: [],
      noChanges: true,
      rating: 100,
      report: 'The code is correct.',
      shouldSave: false,
      tools: [],
    },
    status: 'success',
  });
  const proxyRegistry = new ProxyRegistry([new NoProxy()]);
  const context = new GlobalContext({
    browserSession: new BrowserSession(proxyRegistry),
    documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
    mastra: {
      getWorkflowById: (id) => ({
        createRun: async () => ({ start: id === 'write-workflow' ? buildStart : healStart }),
      }),
      listTools: () => ({}),
    } as any,
    proxyRegistry,
    storage: db.storage,
  });
  const service = new DataService({
    context,
    itemSchema: z.object({ id: z.string() }),
    name: 'serialized-build-heal',
    sources: [new DataSource({ url: 'https://example.test/items' })],
  });
  const building = service.build();
  await vi.waitFor(() => expect(buildStart).toHaveBeenCalledOnce());

  const healing = service.heal();
  await Promise.resolve();
  expect(healStart).not.toHaveBeenCalled();

  finishBuild({
    result: [
      {
        code: `export const itemSchema = { type: 'object' };
export const uniqueId = item => item.id;
export const check = async url => true;
export const run = async url => [{ id: 'item' }];`,
        groupingName: 'items',
      },
    ],
    status: 'success',
  });
  await Promise.all([building, healing]);

  expect(healStart).toHaveBeenCalledOnce();
});
