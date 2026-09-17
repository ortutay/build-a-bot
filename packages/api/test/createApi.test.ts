import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DataService, type GlobalContext, Item } from '@build-a-bot/core';
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
      total: 21,
    });
    const detail = vi.spyOn(service, 'detail').mockImplementation(async (uniqueId) => {
      return uniqueId === 'item-1' ? { value: 'One' } : null;
    });
    const syncResult = {
      created: [
        new Item({
          id: 'row-1',
          uniqueId: 'job-1',
          data: { value: 'One' },
          sourceUrl: 'https://example.com/jobs',
          sourceScriptId: 'script-1',
          createdAt: '2026-09-14T00:00:00.000Z',
          updatedAt: '2026-09-14T00:00:00.000Z',
          lastSeenAt: '2026-09-14T01:00:00.000Z',
        }),
      ],
      updated: [],
      outcome: {
        success: [{ url: 'https://example.com/jobs' }],
        unhandled: [{ url: 'invalid-url' }],
        errors: [{ url: 'https://example.com/broken', error: 'Extraction failed' }],
      },
    };
    const sync = vi.spyOn(service, 'sync').mockResolvedValue(syncResult);
    const start = vi.spyOn(service, 'start').mockImplementation(async () => {
      await service.sync([]);
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
      total: 21,
      count: 1,
      next: `${baseUrl}/local/catalog/items?page=3&limit=10`,
      prev: `${baseUrl}/local/catalog/items?page=1&limit=10`,
      results: [{ id: 'item-1', value: 'One' }],
    });
    const first = await fetch(`${baseUrl}/local/catalog/items?limit=10`).then((resp) =>
      resp.json()
    );
    expect(first.prev).toBeNull();
    expect(first.next).toBe(`${baseUrl}/local/catalog/items?limit=10&page=2`);
    expect(Object.keys(first)).toEqual(['total', 'count', 'next', 'prev', 'results']);
    const last = await fetch(`${baseUrl}/local/catalog/items?page=3&limit=10`).then((resp) =>
      resp.json()
    );
    expect(last.next).toBeNull();
    expect(last.prev).toBe(`${baseUrl}/local/catalog/items?page=2&limit=10`);
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
    const post = (body?: string) =>
      fetch(`${baseUrl}/local/catalog/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    const urls = ['https://example.com/jobs', 'invalid-url', 'https://example.com/broken'];
    const synced = await post(JSON.stringify({ urls }));
    expect(synced.status).toBe(200);
    await expect(synced.json()).resolves.toEqual(syncResult);
    expect(sync).toHaveBeenLastCalledWith(urls);
    expect(sync).toHaveBeenCalledTimes(2);

    const emptyResult = {
      created: [],
      updated: [],
      outcome: { success: [], unhandled: [], errors: [] },
    };
    sync.mockResolvedValueOnce(emptyResult);
    await expect(post(JSON.stringify({ urls: [] })).then((resp) => resp.json())).resolves.toEqual(
      emptyResult
    );
    expect(sync).toHaveBeenLastCalledWith([]);

    for (const body of [
      undefined,
      '{}',
      '{',
      'null',
      '{"urls":"https://example.com"}',
      '{"urls":[1]}',
    ]) {
      const invalid = await post(body);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toHaveProperty('error');
    }
    expect(sync).toHaveBeenCalledTimes(3);

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      sync.mockRejectedValueOnce(new Error('Storage unavailable'));
      const failed = await post(JSON.stringify({ urls }));
      expect(failed.status).toBe(500);
      await expect(failed.json()).resolves.toEqual({ error: 'Internal server error' });
    } finally {
      log.mockRestore();
    }
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
    const sync = document.paths['/local/catalog/sync'] as any;
    const request = sync.post.requestBody.content['application/json'].schema;
    expect(request.properties.urls).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(request.properties).not.toHaveProperty('policy');
    const result = sync.post.responses[200].content['application/json'].schema;
    expect(result.required).toEqual(['created', 'updated', 'outcome']);
    expect(result.properties).not.toHaveProperty('removed');
    expect(result.properties.outcome.required).toEqual(['success', 'unhandled', 'errors']);
    expect(result.properties.created.items.required).toContain('lastSeenAt');
    expect(result.properties.updated.items.properties.after).toEqual(
      result.properties.created.items
    );
    expect(sync.post.responses).not.toHaveProperty('422');
    expect(JSON.stringify(document.paths['/local/catalog/items'])).not.toContain('"allOf"');
  });
});
