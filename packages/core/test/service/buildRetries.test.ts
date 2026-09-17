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
import { markAvailableTool } from '../../src/mastra/instruments/availableTools.js';
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

it('activates all generated scripts without retrying failed candidates', async () => {
  const { service, context, start } = await setup([a, b, c]);
  const good = code([a]);
  const bad = code([b, c], true);
  start.mockResolvedValueOnce(result(good, bad));
  await service.build();
  expect(start).toHaveBeenCalledOnce();
  expect(
    (await Script.findActiveForDataService(context, service.id!))
      .map((script) => script.code)
      .sort()
  ).toEqual([good, bad].sort());
  expect((await service.sync([a, b, c])).outcome).toEqual({
    success: [{ url: a }],
    unhandled: [],
    errors: [b, c].map((url) => ({ url, error: 'Source unavailable' })),
  });
});

it('generates each group once without build-time repair', async () => {
  const { service, start } = await setup([a, b, c]);
  start.mockResolvedValueOnce(result(code([a]), code([b], true), code([c], true)));
  await service.build();
  expect(start.mock.calls.map(([input]) => input.inputData.urls)).toEqual([[a, b, c]]);
  expect((await service.sync([a, b, c])).created).toHaveLength(1);
});

it('activates a replacement once and leaves repair to healing', async () => {
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
  start.mockResolvedValueOnce(result(code([a]), placeholder));
  await service.build();
  expect(await db.storage.db.select().from(itemsTable)).toEqual(snapshots);
  expect(start).toHaveBeenCalledTimes(2);
  expect(start.mock.calls[1][0].inputData.urls).toEqual([a, b, c, d]);
  const changes = await service.sync([a, b, c, d]);
  expect(changes.outcome.success).toEqual([{ url: a }]);
  expect(changes.outcome.errors).toEqual(
    [b, c, d].map((url) => ({ url, error: 'Script generation failed: provider unavailable' }))
  );
  expect(changes.created).toEqual([]);
  expect(changes.updated).toEqual([]);
  expect((await service.list()).total).toBe(first.created.length);
  await service.build();
  expect(start).toHaveBeenCalledTimes(2);
});

it('rebuilds for tool names and schemas but ignores tool order and injected background fields', async () => {
  const { service, context, start } = await setup([a]);
  const first = await markAvailableTool({
    id: 'first',
    inputSchema: z.object({}),
    execute: async () => ({}),
  });
  const second = await markAvailableTool({ id: 'second', execute: async () => ({}) });
  const listTools = vi.spyOn(context.mastra, 'listTools');
  listTools.mockReturnValue({ first, second } as never);
  start.mockResolvedValue(result(code([a])));
  await service.build();
  listTools.mockReturnValue({ second, first } as never);
  await service.build();
  expect(start).toHaveBeenCalledOnce();
  listTools.mockReturnValue({
    first: { ...first, inputSchema: z.object({ _background: z.boolean().optional() }) },
    second,
  } as never);
  await service.build();
  expect(start).toHaveBeenCalledOnce();
  const changed = { ...first, inputSchema: z.object({ changed: z.string() }) };
  listTools.mockReturnValue({
    first: changed,
    second,
  } as never);
  await service.build();
  expect(start).toHaveBeenCalledTimes(2);
  const outputChanged = { ...changed, outputSchema: z.object({ ok: z.boolean() }) };
  listTools.mockReturnValue({ first: outputChanged, second } as never);
  await service.build();
  expect(start).toHaveBeenCalledTimes(3);
  listTools.mockReturnValue({ first: outputChanged } as never);
  await service.build();
  expect(start).toHaveBeenCalledTimes(4);
  expect(start.mock.calls[3][0].inputData.tools).toEqual(['first']);
});

it('keeps identity separate from the schema sent to generation', async () => {
  const { context, start } = await setup([a]);
  const itemSchema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
  const service = new DataService({
    context,
    name: 'identity-build',
    sources: [new DataSource({ url: a })],
    itemSchema,
    identity: { fields: [{ path: 'id' }] },
  });
  start.mockResolvedValue(
    result(
      code([a]).replace(
        'item => item.id',
        "item => { throw new Error('Not the configured identity'); }"
      )
    )
  );
  await service.build();
  expect(start.mock.calls[0][0].inputData.itemSchema).toEqual(itemSchema);
  expect(service.dump().identity).toEqual(service.identity);
  expect(service.dump().itemSchema).toEqual(itemSchema);
  service.identity = { fields: [{ path: 'id', normalize: 'lowercase' }] };
  await service.build();
  expect(start).toHaveBeenCalledTimes(2);
});
