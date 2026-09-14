import type { Mastra } from '@mastra/core';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { failureScript } from '../../src/compile/failureScript.js';
import { Script } from '../../src/compile/Script.js';
import { GlobalContext } from '../../src/context/index.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/documents/index.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { DataService } from '../../src/service/DataService.js';
import { DataSource } from '../../src/service/DataSource.js';
import { itemsTable } from '../../src/storage/db/schema.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

const a = 'https://example.test/a';
const b = 'https://example.test/b';
const c = 'https://example.test/c';
const d = 'https://example.test/d';
const code = (urls: string[], fail = false) => `
  export const itemSchema = { type: 'object' };
  export const check = async url => ${JSON.stringify(urls)}.includes(url);
  export const uniqueId = item => item.id;
  export const run = async url => {
    ${fail ? "throw new Error('Source unavailable');" : 'return [{ id: url }];'}
  };
`;
const result = (...codes: string[]) => ({
  status: 'success',
  result: codes.map((code, i) => ({ code, groupingName: `group-${i}` })),
});
let db: TemporaryDb;
afterEach(async () => {
  await db?.dispose();
});
const setup = async (urls: string[]) => {
  db = await createTemporaryDb();
  const start = vi.fn();
  const context = new GlobalContext({
    storage: db.storage,
    documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
    proxyRegistry: new ProxyRegistry([new NoProxy()]),
    mastra: {
      getWorkflowById: () => ({ createRun: async () => ({ start }) }),
      listTools: () => ({}),
    } as unknown as Mastra,
  });
  const service = new DataService({
    context,
    name: 'build-retries',
    sources: urls.map((url) => new DataSource({ url })),
    itemSchema: z.object({ id: z.string() }),
  });
  return { service, context, start };
};

it('repairs only the failed script URLs and preserves the other candidate code', async () => {
  const { service, context, start } = await setup([a, b, c]);
  const good = code([a]);
  const bad = code([b, c], true);
  const repaired = code([b, c]);
  start.mockResolvedValueOnce(result(good, bad)).mockResolvedValueOnce(result(repaired));
  await service.build();
  expect(start).toHaveBeenCalledTimes(2);
  expect(start.mock.calls[1][0].inputData.urls).toEqual([b, c]);
  expect(start.mock.calls[1][0].inputData.goal).toContain('Source unavailable');
  expect(start.mock.calls[1][0].inputData.goal).toContain(bad);
  expect(
    (await Script.findActiveForDataService(context, service.id!))
      .map((script) => script.code)
      .sort()
  ).toEqual([good, repaired].sort());
  expect((await service.sync([a, b, c])).outcome).toEqual({
    success: [a, b, c].map((url) => ({ url })),
    unhandled: [],
    errors: [],
  });
});

it('repairs separate failing groups without regenerating successful groups', async () => {
  const { service, start } = await setup([a, b, c]);
  start
    .mockResolvedValueOnce(result(code([a]), code([b], true), code([c], true)))
    .mockResolvedValueOnce(result(code([b])))
    .mockResolvedValueOnce(result(code([c])));
  await service.build();
  expect(start.mock.calls.map(([input]) => input.inputData.urls)).toEqual([[a, b, c], [b], [c]]);
  expect((await service.sync([a, b, c])).created).toHaveLength(3);
});

it('activates a persistent generation failure alongside working scripts and preserves prior items', async () => {
  const { service, context, start } = await setup([a, b, c, d]);
  start.mockResolvedValueOnce(result(code([a]), code([b, c, d])));
  await service.build();
  const first = await service.sync([a, b, c, d]);
  const snapshots = await db.storage.db.select().from(itemsTable);
  for (const script of await Script.findActiveForDataService(context, service.id!)) {
    script.name = `previous-${script.id}`;
    await script.save();
  }
  const placeholder = failureScript([b, c, d], 'Script generation failed: provider unavailable');
  start
    .mockResolvedValueOnce(result(code([a]), placeholder))
    .mockResolvedValueOnce(result(placeholder));
  await service.build();
  expect(await db.storage.db.select().from(itemsTable)).toEqual(snapshots);
  expect(start).toHaveBeenCalledTimes(3);
  expect(start.mock.calls[2][0].inputData.urls).toEqual([b, c, d]);
  const changes = await service.sync([a, b, c, d]);
  expect(changes.outcome.success).toEqual([{ url: a }]);
  expect(changes.outcome.errors).toEqual(
    [b, c, d].map((url) => ({ url, error: 'Script generation failed: provider unavailable' }))
  );
  expect(changes.created).toEqual([]);
  expect(changes.updated).toEqual([]);
  expect(changes.removed).toEqual([]);
  expect((await service.list()).total).toBe(first.created.length);
  await service.build();
  expect(start).toHaveBeenCalledTimes(3);
});
