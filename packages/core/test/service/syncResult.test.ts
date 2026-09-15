import type { Mastra } from '@mastra/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Run } from '../../src/compile/Run.js';
import { Script } from '../../src/compile/Script.js';
import { GlobalContext } from '../../src/context/index.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/documents/index.js';
import { log } from '../../src/logger.js';
import { markAvailableTool } from '../../src/mastra/instruments/availableTools.js';
import { NoProxy, ProxyRegistry } from '../../src/proxy/index.js';
import { DataService } from '../../src/service/DataService.js';
import { DataSource } from '../../src/service/DataSource.js';
import { Item } from '../../src/service/Item.js';
import { type IdentityConfig, entityId } from '../../src/service/identity.js';
import {
  dataServicesTable,
  itemsTable,
  resultsTable,
  runsTable,
} from '../../src/storage/db/schema.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

const a = 'https://example.test/a';
const b = 'https://example.test/b';
const other = 'https://other.test/job';
const code = (check = "new URL(url).hostname === 'example.test'") => `
  export const itemSchema = { type: 'object' };
  export const uniqueId = item => item.key;
  export const check = async url => {
    await tools.trace({ phase: 'check', url });
    return (${check});
  };
  export const run = async url => {
    await tools.trace({ phase: 'run', url });
    return await tools.fixture({ url });
  };
`;
const empty = () => ({
  created: [],
  updated: [],
  removed: [],
  outcome: { success: [], unhandled: [], errors: [] },
});

describe('sync change reporting', () => {
  let db: TemporaryDb;
  afterEach(async () => {
    vi.restoreAllMocks();
    await db?.dispose();
  });

  const setup = async (identity?: IdentityConfig) => {
    db = await createTemporaryDb();
    const data = new Map<string, unknown[]>([
      [a, []],
      [b, []],
    ]);
    const fixture = vi.fn(async ({ url }: { url: string }) => data.get(url));
    const tool = await markAvailableTool({ id: 'fixture', execute: fixture });
    const trace = vi.fn(async (_input: { phase: string; url: string }) => ({}));
    const traceTool = await markAvailableTool({ id: 'trace', execute: trace });
    const context = new GlobalContext({
      storage: db.storage,
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      proxyRegistry: new ProxyRegistry([new NoProxy()]),
      mastra: { listTools: () => ({ fixture: tool, trace: traceTool }) } as unknown as Mastra,
    });
    const service = new DataService({
      context,
      name: 'sync-results',
      identity,
      sources: [a, b].map((url) => new DataSource({ url })),
      itemSchema: z.object({ key: z.string(), text: z.string() }),
    });
    await service.save();
    const addScript = async (scriptCode: string) => {
      const script = new Script({
        context,
        dataServiceId: service.id!,
        name: scriptCode,
        code: scriptCode,
        tools: ['fixture', 'trace'],
        modules: [],
        vmContext: ['URL'],
      });
      await script.save();
      return script;
    };
    const script = await addScript(code());
    return { service, data, fixture, addScript, script, trace };
  };

  it('reports returned tool errors per URL and preserves previous source items', async () => {
    const { service, data, fixture } = await setup();
    data.set(a, [{ key: 'a', text: 'Before' }]);
    await service.sync([a]);
    fixture.mockImplementation(async ({ url }) =>
      url === a
        ? ({ isError: true, message: 'Tool validation failed' } as never)
        : [{ key: 'b', text: 'Working' }]
    );
    const changes = await service.sync([a, b]);
    expect(changes.outcome.errors).toEqual([{ url: a, error: 'fixture: Tool validation failed' }]);
    expect(changes.outcome.success).toEqual([{ url: b }]);
    expect(changes.removed).toEqual([]);
    expect((await service.list()).results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'a', text: 'Before' }),
        expect.objectContaining({ key: 'b', text: 'Working' }),
      ])
    );
  });

  it('reports creates, updates and removals using script IDs and full data, with stable repeats', async () => {
    const { service, data } = await setup();
    data.set(a, [
      { key: 'keep', text: 'Before' },
      { key: 'gone', text: 'Gone' },
    ]);
    const first = await service.sync([a]);
    expect(first.created).toHaveLength(2);
    expect(first.outcome.success).toEqual([{ url: a }]);
    data.set(a, [
      { text: 'Before', key: 'keep' },
      { text: 'Gone', key: 'gone' },
    ]);
    expect(await service.sync([a])).toEqual({
      ...empty(),
      outcome: { success: [{ url: a }], unhandled: [], errors: [] },
    });
    data.set(a, [
      { key: 'keep', text: 'Before ' },
      { key: 'new', text: 'New' },
    ]);
    const changes = await service.sync([a]);
    expect(changes.created.map((item) => item.uniqueId)).toEqual(['new']);
    expect(changes.removed[0]).toEqual(first.created[1]);
    expect(changes.updated).toHaveLength(1);
    expect(changes.updated[0].before).toEqual(first.created[0]);
    expect(changes.updated[0].after).toMatchObject({
      id: first.created[0].id,
      uniqueId: 'keep',
      data: { key: 'keep', text: 'Before ' },
    });
    expect((await service.list()).total).toBe(2);
  });

  it('isolates invalid inputs and execution failures, deduplicates URLs, and retains failed-source data', async () => {
    const { service, data, fixture } = await setup();
    data.set(a, [{ key: 'old', text: 'Preserved' }]);
    await service.sync([a]);
    fixture.mockImplementation(async ({ url }) => {
      if (url === a) {
        throw new Error('Source unavailable');
      }
      return [{ key: 'new', text: 'Success' }];
    });
    const changes = await service.sync([
      a,
      b,
      b,
      'https://EXAMPLE.test:443/b',
      other,
      'invalid',
      'invalid',
    ]);
    expect(changes.outcome).toEqual({
      success: [{ url: b }],
      unhandled: [{ url: 'invalid' }, { url: other }],
      errors: [{ url: a, error: 'Source unavailable' }],
    });
    expect(changes.created).toHaveLength(1);
    expect(changes.removed).toEqual([]);
    expect((await service.list()).results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'old' }),
        expect.objectContaining({ key: 'new' }),
      ])
    );
    expect(await service.sync([])).toEqual(empty());
  });

  it.each([
    'invalid JavaScript !',
    code('(() => { throw new Error("Broken check"); })()'),
    code('[]'),
  ])('keeps working routes when another script cannot compile or check', async (broken) => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const { service, data, addScript } = await setup();
    data.set(a, [{ key: 'ok', text: 'Good' }]);
    await addScript(broken);
    const changes = await service.sync([a, other]);
    expect(changes.created).toHaveLength(1);
    expect(changes.outcome.success).toEqual([{ url: a }]);
    expect(changes.outcome.unhandled).toEqual([{ url: other }]);
    expect(changes.outcome.errors).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Could not compile script|check failed/)
    );
  });

  it('reports ambiguous routes without preventing other URLs from running', async () => {
    const { service, data, addScript } = await setup();
    data.set(b, [{ key: 'ok', text: 'Good' }]);
    await addScript(code(`url === ${JSON.stringify(a)}`));
    const changes = await service.sync([a, b]);
    expect(changes.outcome).toEqual({
      success: [{ url: b }],
      unhandled: [{ url: a }],
      errors: [],
    });
    expect(changes.created).toHaveLength(1);
  });

  it('rolls back changes and run results on a write failure while continuing later sources', async () => {
    const { service, data } = await setup();
    data.set(a, [
      { key: 'keep', text: 'Before' },
      { key: 'gone', text: 'Preserve on failure' },
    ]);
    await service.sync([a]);
    const before = await db.storage.db.select().from(itemsTable);
    data.set(a, [
      { key: 'keep', text: 'After' },
      { key: 'new', text: 'Rollback' },
    ]);
    data.set(b, [{ key: 'ok', text: 'Good' }]);
    const complete = Run.prototype.complete;
    vi.spyOn(Run.prototype, 'complete').mockImplementation(async function (this: Run, ...args) {
      await complete.apply(this, args);
      if (this.input.url === a) {
        throw new Error('Write failed');
      }
    });
    const changes = await service.sync([a, b]);
    expect(changes.created.map((item) => item.uniqueId)).toEqual(['ok']);
    expect(changes.updated).toEqual([]);
    expect(changes.removed).toEqual([]);
    expect(changes.outcome.errors).toEqual([{ url: a, error: 'Write failed' }]);
    const items = await db.storage.db.select().from(itemsTable);
    expect(items.filter((item) => item.sourceUrl === a)).toEqual(before);
    expect(await db.storage.db.select().from(resultsTable)).toHaveLength(3);
    const runs = await db.storage.db.select().from(runsTable);
    expect(runs.filter((run) => run.status === 'error')).toHaveLength(1);
  });
  it('checks and runs individual URLs concurrently', async () => {
    const { service, fixture, trace } = await setup();
    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture.mockImplementation(async ({ url }) => {
      started++;
      if (started === 2) {
        release();
      }
      await bothStarted;
      return [{ key: url, text: 'Concurrent' }];
    });
    const changes = await service.sync([a, b, other]);
    expect(changes.created).toHaveLength(2);
    expect(trace.mock.calls.map(([input]) => input)).toEqual([
      { phase: 'check', url: a },
      { phase: 'check', url: b },
      { phase: 'check', url: other },
      { phase: 'run', url: a },
      { phase: 'run', url: b },
    ]);
    const runs = await db.storage.db.select().from(runsTable);
    expect(runs.map((run) => run.input)).toEqual([{ url: a }, { url: b }]);
  });

  it('clears an explicitly empty source while retaining another source', async () => {
    const { service, data } = await setup();
    data.set(a, [{ key: 'old', text: 'Remove' }]);
    data.set(b, [{ key: 'keep', text: 'Keep' }]);
    await service.sync([a, b]);
    data.set(a, []);
    const changes = await service.sync([a, b]);
    expect(changes.removed.map((item) => item.uniqueId)).toEqual(['old']);
    expect(changes.created).toEqual([]);
    expect(changes.outcome.success).toEqual([{ url: a }, { url: b }]);
    expect((await service.list()).total).toBe(1);
  });

  it.each([
    { name: 'undefined', output: 'undefined' },
    { name: 'null', output: 'null' },
    { name: 'single object', output: '{ key: "bad", text: "Must be an array" }' },
    { name: 'invalid item', output: '[{ key: "bad", text: 42 }]' },
    { name: 'legacy envelope', output: '[{ url, result: { key: "bad", text: "Wrapped" } }]' },
  ])('preserves snapshots on $name output while committing another URL', async ({ output }) => {
    const { service, data, script } = await setup();
    data.set(a, [{ key: 'old', text: 'Preserved' }]);
    await service.sync([a]);
    script.code =
      code().split('export const run')[0] +
      `export const run = async url => url === ${JSON.stringify(a)} ? (${output}) : [{ key: 'ok', text: 'New' }];`;
    await script.save();
    const changes = await service.sync([a, b]);
    expect(changes.outcome.success).toEqual([{ url: b }]);
    expect(changes.outcome.errors).toEqual([{ url: a, error: expect.any(String) }]);
    expect(changes.removed).toEqual([]);
    expect(changes.created.map((item) => item.uniqueId)).toEqual(['ok']);
    expect((await service.list()).results).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'old' })])
    );
  });

  it('handles a thrown check error for only that URL', async () => {
    const { service, data, script } = await setup();
    data.set(b, [{ key: 'ok', text: 'Good' }]);
    script.code = code(
      `(() => { if (url === ${JSON.stringify(a)}) { throw new Error('Check failed'); } return true; })()`
    );
    await script.save();
    const changes = await service.sync([a, b]);
    expect(changes.outcome).toEqual({ success: [{ url: b }], unhandled: [{ url: a }], errors: [] });
  });
  it('compares across script versions while isolating other services and source URLs', async () => {
    const { service, data, script, addScript, fixture } = await setup();
    data.set(a, [
      { key: 'keep', text: 'Before' },
      { key: 'gone', text: 'Remove' },
    ]);
    data.set(b, [{ key: 'other-url', text: 'Untouched' }]);
    const first = await service.sync([a, b]);
    const context = await service.context();
    const otherService = new DataService({
      context,
      name: 'other-service',
      sources: [new DataSource({ url: a })],
      itemSchema: z.object({ key: z.string(), text: z.string() }),
    });
    await otherService.save();
    const otherScript = new Script({
      context,
      dataServiceId: otherService.id!,
      name: 'other-script',
      code: code(),
      tools: ['fixture', 'trace'],
      modules: [],
      vmContext: ['URL'],
    });
    await otherScript.save();
    await otherService.sync([a]);
    const otherBefore = await otherService.list();
    script.active = false;
    await script.save();
    const replacement = await addScript(code());
    expect((await service.list()).total).toBe(3);
    expect(await service.detail('keep')).toEqual({ key: 'keep', text: 'Before' });
    const repeated = await service.sync([a]);
    expect(repeated.updated).toEqual([]);
    expect(repeated.created).toEqual([]);
    const beforeFailure = await db.storage.db.select().from(itemsTable);
    fixture.mockRejectedValueOnce(new Error('Replacement unavailable'));
    expect((await service.sync([a])).outcome.errors).toHaveLength(1);
    expect(await db.storage.db.select().from(itemsTable)).toEqual(beforeFailure);
    data.set(a, [
      { key: 'keep', text: 'After' },
      { key: 'new', text: 'Created' },
    ]);
    const changes = await service.sync([a]);
    expect(changes.updated).toHaveLength(1);
    expect(changes.updated[0].before.sourceScriptId).toBe(script.id);
    expect(changes.updated[0].after.sourceScriptId).toBe(replacement.id);
    expect(changes.updated[0].after.id).toBe(
      first.created.find((item) => item.uniqueId === 'keep')!.id
    );
    expect(changes.created.map((item) => item.uniqueId)).toEqual(['new']);
    expect(changes.removed.map((item) => item.uniqueId)).toEqual(['gone']);
    expect(await service.detail('other-url')).toEqual({ key: 'other-url', text: 'Untouched' });
    expect(await otherService.list()).toEqual(otherBefore);
    expect((await service.list()).total).toBe(3);
  });

  it('reconciles duplicate source items left by older script versions', async () => {
    const { service, data, script, addScript } = await setup();
    data.set(a, [{ key: 'same', text: 'Before' }]);
    await service.sync([a]);
    script.active = false;
    await script.save();
    const replacement = await addScript(code());
    await new Item({
      data: { key: 'same', text: 'Before' },
      uniqueId: 'same',
      sourceUrl: a,
      sourceScriptId: replacement.id!,
    }).save(db.storage);
    expect((await service.list()).total).toBe(2);
    data.set(a, [{ key: 'same', text: 'After' }]);
    const changes = await service.sync([a]);
    expect(changes.updated).toHaveLength(1);
    expect(changes.created).toEqual([]);
    expect(changes.removed).toEqual([]);
    expect((await service.list()).total).toBe(1);
    data.set(a, []);
    expect((await service.sync([a])).removed).toHaveLength(1);
  });
  it.each([undefined, { fields: [{ path: 'key' }] }])(
    'warns on conflicting duplicates and retains the first item',
    async (identity) => {
      const { service, data } = await setup(identity);
      const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
      data.set(a, [
        { key: 'one', text: 'First' },
        { key: 'one', text: 'First' },
      ]);
      await service.sync([a]);
      expect(warn).not.toHaveBeenCalled();
      data.set(a, [
        { key: 'one', text: 'First' },
        { key: 'one', text: 'Conflict' },
      ]);
      const changes = await service.sync([a]);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Conflicting records share identity')
      );
      expect(changes.outcome.errors).toEqual([]);
      expect(changes.updated).toEqual([]);
      expect((await service.list()).results[0]).toMatchObject({ text: 'First' });
    }
  );

  it('uses configured identity across script changes and persists it when reloaded', async () => {
    const identity: IdentityConfig = { fields: [{ path: 'key', normalize: 'digits' }] };
    const { service, data, script, addScript } = await setup(identity);
    data.set(a, [{ key: '556074-3089', text: 'Before' }]);
    const first = await service.sync([a]);
    expect(first.created[0].uniqueId).toBe(entityId({ key: '5560743089' }, identity));
    script.active = false;
    await script.save();
    await addScript(
      code().replace(
        'item => item.key',
        "item => { throw new Error('Unused generated identity'); }"
      )
    );
    const loaded = (await DataService.findById(await service.context(), service.id!))!;
    expect(loaded.identity).toEqual(identity);
    const [stored] = await db.storage.db.select().from(dataServicesTable);
    expect(stored.identity).toEqual(identity);
    expect(stored.itemSchema).toEqual(service.dump().itemSchema);
    data.set(a, [{ key: '5560743089', text: 'After' }]);
    const changes = await loaded.sync([a]);
    expect(changes.updated).toHaveLength(1);
    expect(changes.updated[0].after.id).toBe(first.created[0].id);
    expect(changes.updated[0].after.uniqueId).toBe(first.created[0].uniqueId);
    expect(changes.created).toEqual([]);
    expect(changes.removed).toEqual([]);
    data.set(a, [{ key: '', text: 'Missing identity' }]);
    expect((await loaded.sync([a])).outcome.errors).toHaveLength(1);
    expect((await loaded.list()).results[0]).toMatchObject({ text: 'After' });
  });

  it('adopts configured identity without changing existing item IDs', async () => {
    const { service, data } = await setup();
    data.set(a, [{ key: '556074-3089', text: 'Before' }]);
    const first = await service.sync([a]);
    const configured = new DataService({
      ...service.dump(),
      id: service.id!,
      context: await service.context(),
      sources: service.sources,
      identity: { fields: [{ path: 'key', normalize: 'digits' }] },
    });
    data.set(a, [{ key: '5560743089', text: 'After' }]);
    const changes = await configured.sync([a]);
    expect(changes.created).toEqual([]);
    expect(changes.removed).toEqual([]);
    expect(changes.updated[0].after.id).toBe(first.created[0].id);
    expect(changes.updated[0].after.uniqueId).toBe(first.created[0].uniqueId);
  });

  it('clears persisted identity when disabled', async () => {
    const { service } = await setup({ fields: [{ path: 'key' }] });
    service.identity = null;
    await service.save();
    const loaded = (await DataService.findById(await service.context(), service.id!))!;
    expect(loaded.identity).toBeNull();
    const [stored] = await db.storage.db.select().from(dataServicesTable);
    expect(stored.identity).toBeNull();
  });
});
