import { type Tool } from '@mastra/core/tools';
import { describe, expect, it } from 'vitest';
import {
  addInstruments,
  cacheInstrument,
  markAvailableTool,
  selectAvailableTools,
} from '../../src/mastra/instruments/index.js';

describe('available tools', () => {
  it('includes only marked tools', async () => {
    const fetchTool = await markAvailableTool(tool('fetchTool'));
    const browserTool = await markAvailableTool(tool('browserTools_gotoTool'));
    const documentTool = await markAvailableTool(tool('documentTools_getTool'));

    expect(
      selectAvailableTools({
        fetchTool,
        browserTools_gotoTool: browserTool,
        documentTools_getTool: documentTool,
        codeTools_runJsSnippetTool: tool('codeTools_runJsSnippetTool'),
      })
    ).toEqual({
      fetchTool,
      browserTools_gotoTool: browserTool,
      documentTools_getTool: documentTool,
    });
  });

  it('keeps tools available when composed with object-replacing instruments', async () => {
    const cacheThenAvailable = tool('cacheThenAvailable');
    const availableThenCache = tool('availableThenCache');
    const unmarked = tool('unmarked');

    const cachedThenAvailable = await addInstruments(
      [cacheInstrument, markAvailableTool],
      cacheThenAvailable
    );
    const availableThenCached = await addInstruments(
      [markAvailableTool, cacheInstrument],
      availableThenCache
    );
    const cachedUnmarked = await cacheInstrument(unmarked);

    expect(cachedThenAvailable).not.toBe(cacheThenAvailable);
    expect(availableThenCached).not.toBe(availableThenCache);
    expect(
      selectAvailableTools({
        cacheThenAvailable: cachedThenAvailable,
        availableThenCache: availableThenCached,
        unmarked: cachedUnmarked,
      })
    ).toEqual({
      cacheThenAvailable: cachedThenAvailable,
      availableThenCache: availableThenCached,
    });
  });

  it('does not cache tool errors', async () => {
    let calls = 0;
    const failingTool = {
      ...tool(`failing-${crypto.randomUUID()}`),
      execute: async () => {
        calls++;
        throw new Error('Temporary failure');
      },
    };
    const cachedTool = await cacheInstrument(failingTool);

    await expect(cachedTool.execute!({}, {} as any)).rejects.toThrow('Temporary failure');
    await expect(cachedTool.execute!({}, {} as any)).rejects.toThrow('Temporary failure');

    expect(calls).toBe(2);
  });
});

const tool = (id: string): Tool =>
  ({
    id,
    description: id,
    execute: async () => ({}),
  }) as Tool;
