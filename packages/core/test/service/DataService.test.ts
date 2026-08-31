import type { Mastra } from '@mastra/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Script } from '../../src/internal/compile/Script.js';
import { DocumentLibrary, MemoryLibraryBackend } from '../../src/internal/documents/index.js';
import { markAvailableTool } from '../../src/internal/mastra/instruments/availableTools.js';
import { DataSource } from '../../src/source/DataSource.js';
import { DataService } from '../../src/service/DataService.js';
import type { ServiceContext } from '../../src/service/Service.js';
import { createTemporaryDb, type TemporaryDb } from '../lib/temporaryDb.js';

const scriptCode = `
  export const inputSchema = { type: 'object' };
  export const outputSchema = { type: 'object' };
  export const exampleInput = {};
  export const run = async () => ({});
`;

describe('DataService', () => {
  let temporaryDb: TemporaryDb | null = null;

  afterEach(async () => {
    await temporaryDb?.dispose();
    temporaryDb = null;
  });

  it('generates and saves a script once, then reuses it for the same source', async () => {
    temporaryDb = await createTemporaryDb();
    let workflowRuns = 0;
    const fetchTool = await markAvailableTool({ id: 'fetchTool', execute: async () => ({}) });
    const mastra = {
      getWorkflowById: () => ({
        createRun: async () => ({
          start: async () => {
            workflowRuns++;
            return { result: { code: scriptCode }, status: 'success' };
          },
        }),
      }),
      listTools: () => ({ fetchTool }),
    } as unknown as Mastra;
    const storage = temporaryDb.storage;
    const documentLibrary = new DocumentLibrary(new MemoryLibraryBackend());
    const service = new DataService({
      name: 'example-service',
      sources: [new DataSource({ url: 'https://example.test/data' })],
      itemSchema: z.object({ value: z.string() }),
      mastra,
      storage,
      documentLibrary,
    });
    const context: ServiceContext = { documentLibrary, mastra, storage };

    await service._build(context);
    await service._build(context);

    const script = await Script.findByName(
      temporaryDb.storage,
      service.name,
      'url:https://example.test/data'
    );
    expect(workflowRuns).toBe(1);
    expect(script).toMatchObject({
      name: 'url:https://example.test/data',
      serviceId: expect.any(String),
    });
  });
});
