import { BuildABot, DataService } from '@build-a-bot/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BuildABotAPI, type BuildABotAPIStartResult } from '../src/BuildABotAPI.js';

describe('BuildABotAPI', () => {
  let server: BuildABotAPIStartResult | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('constructs DataService endpoints and delegates list and detail operations', async () => {
    const service = new DataService({
      name: 'catalog',
      sources: [],
      itemSchema: z.object({ value: z.string() }),
    });
    const list = vi.spyOn(service, 'list').mockResolvedValue({
      count: 1,
      results: [{ id: 'item-1', value: 'One' }],
      total: 1,
    });
    const detail = vi.spyOn(service, 'detail').mockImplementation(async (uniqueId) => {
      return uniqueId === 'item-1' ? { value: 'One' } : null;
    });
    const buildABot = new BuildABot({ services: [service] });
    const start = vi.spyOn(buildABot, 'start').mockResolvedValue(undefined);
    const api = new BuildABotAPI({ buildABot });
    server = await api.start({ port: 0 });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    expect(start).toHaveBeenCalledTimes(1);

    await expect(fetch(`${baseUrl}/`)).resolves.toMatchObject({ status: 200 });
    await expect(fetch(`${baseUrl}/`).then((resp) => resp.json())).resolves.toEqual({
      services: ['catalog'],
    });
    await expect(fetch(`${baseUrl}/catalog/health`).then((resp) => resp.json())).resolves.toEqual({
      status: 'ok',
    });
    await expect(
      fetch(`${baseUrl}/catalog/items?page=2&limit=10`).then((resp) => resp.json())
    ).resolves.toEqual({
      count: 1,
      results: [{ id: 'item-1', value: 'One' }],
      total: 1,
    });
    expect(list).toHaveBeenCalledWith({ limit: 10, page: 2 });

    await expect(
      fetch(`${baseUrl}/catalog/items/item-1`).then((resp) => resp.json())
    ).resolves.toEqual({
      value: 'One',
    });
    expect(detail).toHaveBeenCalledWith('item-1');

    const missing = await fetch(`${baseUrl}/catalog/items/missing`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'Item not found' });

    const invalidPage = await fetch(`${baseUrl}/catalog/items?page=zero`);
    expect(invalidPage.status).toBe(400);
    await expect(invalidPage.json()).resolves.toEqual({
      error: 'page and limit must be positive integers',
    });
  });

  it('produces a combined OpenAPI document from DataServices', async () => {
    const service = new DataService({
      name: 'catalog',
      sources: [],
      itemSchema: z.object({ value: z.string() }),
    });
    const buildABot = new BuildABot({ services: [service] });
    const document = new BuildABotAPI({ buildABot }).openApi();

    expect(document).toMatchObject({
      info: { title: 'BuildABot API', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/catalog/items': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        results: {
                          items: {
                            properties: { id: { type: 'string' } },
                            required: expect.arrayContaining(['id']),
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/catalog/items/{id}': {
          get: { parameters: [expect.objectContaining({ in: 'path', name: 'id' })] },
        },
      },
    });
    expect(JSON.stringify(document.paths['/catalog/items'])).not.toContain('"allOf"');
  });
});
