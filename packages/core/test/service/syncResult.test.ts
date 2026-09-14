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
import { itemsTable, resultsTable, runsTable } from '../../src/storage/db/schema.js';
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

  const setup = async () => {
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
});
