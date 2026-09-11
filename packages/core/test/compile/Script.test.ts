import type { Mastra } from '@mastra/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GlobalContext } from '../../src/context/index.js';
import { Script, ScriptDependencyUnavailableError } from '../../src/compile/Script.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/documents/index.js';
import { markAvailableTool } from '../../src/mastra/instruments/availableTools.js';
import { DataService } from '../../src/service/DataService.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

const scriptCode = `
  export const outputSchema = { type: 'string' };
  export const uniqueId = (item) => item;
  export const check = async (urls) => urls.map(() => true);
  export const run = async (urls) => ({
    results: await Promise.all(urls.map((url) => tools.fetchTool({ url }))),
    urlsVisited: urls,
  });
`;

describe('Script', () => {
  let temporaryDb: TemporaryDb | null = null;

  afterEach(async () => {
    await temporaryDb?.dispose();
    temporaryDb = null;
  });

  const createService = async (name: string) => {
    const storage = temporaryDb!.storage;
    const context = new GlobalContext({
      documentLibrary: new DocumentLibrary(new MemoryLibraryBackend()),
      mastra: {} as Mastra,
      storage,
    });
    const service = new DataService({
      context,
      itemSchema: z.object({}),
      name,
      sources: [],
    });
    await service.save();
    return { context, service };
  };

  it('saves, loads, finds, and compiles a script', async () => {
    temporaryDb = await createTemporaryDb();
    const { context, service } = await createService('example-service');
    const script = new Script({
      context,
      dataServiceId: service.id!,
      name: 'url:https://example.test',
      code: scriptCode,
      modules: [],
      tools: ['fetchTool'],
      vmContext: [],
    });

    await script.save();

    const loaded = await Script.findById(context, script.id!);
    const found = await Script.findByName(context, service.id!, script.name);
    const fetchTool = await markAvailableTool({
      id: 'fetchTool',
      execute: async ({ url }: { url: string }) => `echo:${url}`,
    });
    const mastra = { listTools: () => ({ fetchTool }) } as unknown as Mastra;
    const bot = await loaded!.compile(mastra);

    expect(loaded).toMatchObject({
      id: script.id,
      dataServiceId: script.dataServiceId,
      name: script.name,
      tools: ['fetchTool'],
    });
    expect(found?.id).toBe(script.id);
    await expect(Script.findById(context, 'missing')).resolves.toBeNull();
    const urls = ['https://example.test/hello'];
    expect(bot.uniqueId('hello')).toBe('hello');
    await expect(bot.check(urls)).resolves.toEqual([true]);
    await expect(bot.run(urls)).resolves.toEqual({
      results: [`echo:${urls[0]}`],
      urlsVisited: urls,
    });
  });

  it('reports unavailable stored dependencies by name', async () => {
    const script = new Script({
      name: 'missing-dependency',
      code: scriptCode,
      modules: [],
      tools: [],
      vmContext: ['missingContext'],
    });
    const mastra = { listTools: () => ({}) } as unknown as Mastra;

    await expect(script.compile(mastra)).rejects.toBeInstanceOf(ScriptDependencyUnavailableError);
  });

  it('allows one active script per name while retaining inactive versions', async () => {
    temporaryDb = await createTemporaryDb();
    const { context, service } = await createService('example-service');
    const first = new Script({
      context,
      dataServiceId: service.id!,
      name: 'url:https://example.test',
      code: scriptCode,
      modules: [],
      tools: [],
      vmContext: [],
    });
    const duplicate = new Script({
      context,
      dataServiceId: service.id!,
      name: first.name,
      code: scriptCode,
      modules: [],
      tools: [],
      vmContext: [],
    });

    await first.save();

    await expect(duplicate.save()).rejects.toThrow();
    first.active = false;
    await first.save();
    await duplicate.save();
    expect(duplicate.id).not.toBe(first.id);
    await expect(Script.findById(context, first.id!)).resolves.toMatchObject({ active: false });
    const active = await Script.findActiveForDataService(context, service.id!);
    expect(active.map((script) => script.id)).toEqual([duplicate.id]);
  });

  it('does not expose unselected modules', async () => {
    const script = new Script({
      name: 'unselected-module',
      code: `
        export const outputSchema = {};
        export const check = async (urls) => urls.map(() => true);
        export const uniqueId = () => 'unselected-module';
        export const run = async () => playwright;
      `,
      modules: [],
      tools: [],
      vmContext: [],
    });
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const bot = await script.compile(mastra);

    await expect(bot.run(['https://example.test'])).rejects.toThrow('playwright');
  });
});
