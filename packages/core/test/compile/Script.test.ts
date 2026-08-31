import type { Mastra } from '@mastra/core';
import { afterEach, describe, expect, it } from 'vitest';
import { Script, ScriptDependencyUnavailableError } from '../../src/internal/compile/Script.js';
import { markAvailableTool } from '../../src/internal/mastra/instruments/availableTools.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

const scriptCode = `
  export const inputSchema = {
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input'],
  };
  export const outputSchema = { type: 'string' };
  export const exampleInput = { input: 'example' };
  export const run = async ({ input }) => tools.fetchTool({ input });
`;

describe('Script', () => {
  let temporaryDb: TemporaryDb | null = null;

  afterEach(async () => {
    await temporaryDb?.dispose();
    temporaryDb = null;
  });

  it('saves, loads, finds, and compiles a script', async () => {
    temporaryDb = await createTemporaryDb();
    const script = new Script({
      name: 'url:https://example.test',
      code: scriptCode,
      context: [],
      modules: [],
      tools: ['fetchTool'],
    });

    await script.save(temporaryDb.storage, 'example-service');

    const loaded = await Script.findById(temporaryDb.storage, script.id!);
    const found = await Script.findByName(temporaryDb.storage, 'example-service', script.name);
    const fetchTool = await markAvailableTool({
      id: 'fetchTool',
      execute: async ({ input }: { input: string }) => `echo:${input}`,
    });
    const mastra = { listTools: () => ({ fetchTool }) } as unknown as Mastra;
    const bot = await loaded!.compile(mastra);

    expect(loaded).toMatchObject({
      id: script.id,
      serviceId: script.serviceId,
      name: script.name,
      tools: ['fetchTool'],
    });
    expect(found?.id).toBe(script.id);
    await expect(Script.findById(temporaryDb.storage, 'missing')).resolves.toBeNull();
    await expect(bot.run({ input: 'hello' })).resolves.toBe('echo:hello');
  });

  it('reports unavailable stored dependencies by name', async () => {
    const script = new Script({
      name: 'missing-dependency',
      code: scriptCode,
      context: ['missingContext'],
      modules: [],
      tools: [],
    });
    const mastra = { listTools: () => ({}) } as unknown as Mastra;

    await expect(script.compile(mastra)).rejects.toBeInstanceOf(ScriptDependencyUnavailableError);
  });

  it('allows only one script with a name for each service', async () => {
    temporaryDb = await createTemporaryDb();
    const first = new Script({
      name: 'url:https://example.test',
      code: scriptCode,
      context: [],
      modules: [],
      tools: [],
    });
    const duplicate = new Script({
      name: first.name,
      code: scriptCode,
      context: [],
      modules: [],
      tools: [],
    });

    await first.save(temporaryDb.storage, 'example-service');

    await expect(duplicate.save(temporaryDb.storage, 'example-service')).rejects.toThrow();
  });

  it('does not expose unselected modules', async () => {
    const script = new Script({
      name: 'unselected-module',
      code: `
        export const inputSchema = { type: 'object' };
        export const outputSchema = {};
        export const exampleInput = {};
        export const run = async () => playwright;
      `,
      context: [],
      modules: [],
      tools: [],
    });
    const mastra = { listTools: () => ({}) } as unknown as Mastra;
    const bot = await script.compile(mastra);

    await expect(bot.run({})).rejects.toThrow('playwright');
  });
});
