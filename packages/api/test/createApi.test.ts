import { DataService, type GlobalContext } from '@build-a-bot/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { API, type APIStartResult } from '../src/index.js';

describe('API', () => {
  let server: APIStartResult | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('starts services before serving local DataService endpoints', async () => {
    const service = new DataService({
      context: {} as GlobalContext,
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
    const sync = vi.spyOn(service, 'sync').mockResolvedValue({ results: [] });
    const start = vi.spyOn(service, 'start').mockImplementation(async () => {
      await service.sync();
    });
    const api = new API({ services: [service] });
    server = await api.start({ port: 0 });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    expect(start).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();

    await expect(fetch(`${baseUrl}/`)).resolves.toMatchObject({ status: 200 });
    await expect(fetch(`${baseUrl}/`).then((resp) => resp.json())).resolves.toEqual({
      services: ['catalog'],
    });
    await expect(
      fetch(`${baseUrl}/local/catalog/health`).then((resp) => resp.json())
    ).resolves.toEqual({
      status: 'ok',
    });
    await expect(
      fetch(`${baseUrl}/local/catalog/items?page=2&limit=10`).then((resp) => resp.json())
    ).resolves.toEqual({
      count: 1,
      results: [{ id: 'item-1', value: 'One' }],
      total: 1,
    });
    expect(list).toHaveBeenCalledWith({ limit: 10, page: 2 });

    await expect(
      fetch(`${baseUrl}/local/catalog/items/item-1`).then((resp) => resp.json())
    ).resolves.toEqual({
      value: 'One',
    });
    expect(detail).toHaveBeenCalledWith('item-1');

    const missing = await fetch(`${baseUrl}/local/catalog/items/missing`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'Item not found' });

    const invalidPage = await fetch(`${baseUrl}/local/catalog/items?page=zero`);
    expect(invalidPage.status).toBe(400);
    await expect(invalidPage.json()).resolves.toEqual({
      error: 'page and limit must be positive integers',
    });
    await expect(
      fetch(`${baseUrl}/local/catalog/sync`, { method: 'POST' }).then((resp) => resp.json())
    ).resolves.toEqual({ results: [] });
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('produces a combined OpenAPI document from DataServices', async () => {
    const service = new DataService({
      context: {} as GlobalContext,
      name: 'catalog',
      sources: [],
      itemSchema: z.object({ value: z.string() }),
    });
    const document = new API({ services: [service] }).openApi();

    expect(document).toMatchObject({
      info: { title: 'BuildABot API', version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/local/catalog/items': {
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
        '/local/catalog/items/{id}': {
          get: { parameters: [expect.objectContaining({ in: 'path', name: 'id' })] },
        },
      },
    });
    expect(JSON.stringify(document.paths['/local/catalog/items'])).not.toContain('"allOf"');
  });
});
