import { type Express } from 'express';
import { z } from 'zod';
import { DataService, defaultListLimit } from '@build-a-bot/core';

export type DataServiceAPIOptions = { dataService: DataService };

const syncSchema = z.object({ urls: z.array(z.string()) });
const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
};

const parsePositiveInteger = (val: unknown, defaultVal: number): number | null => {
  if (val === undefined) {
    return defaultVal;
  }
  if (Array.isArray(val)) {
    return null;
  }

  const parsed = Number(val);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export class DataServiceAPI {
  dataService: DataService;

  constructor(options: DataServiceAPIOptions) {
    this.dataService = options.dataService;
  }

  openApi(): Record<string, unknown> {
    const itemSchema = z.toJSONSchema(this.dataService.itemSchema) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const listItemSchema = {
      ...itemSchema,
      properties: {
        ...itemSchema.properties,
        id: { type: 'string', description: 'The item unique ID' },
      },
      required: [...new Set([...(itemSchema.required ?? []), 'id'])],
    };
    const storedItemSchema = {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The stored item row ID' },
        uniqueId: { type: 'string', description: 'The item identity' },
        createdAt: { type: ['string', 'null'] },
        updatedAt: { type: ['string', 'null'] },
        lastSeenAt: { type: ['string', 'null'] },
        data: itemSchema,
        sourceUrl: { type: 'string' },
        sourceScriptId: { type: 'string' },
      },
      required: [
        'id',
        'uniqueId',
        'createdAt',
        'updatedAt',
        'lastSeenAt',
        'data',
        'sourceUrl',
        'sourceScriptId',
      ],
    };
    const urlSchema = {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    };
    const { name } = this.dataService;
    const basePath = `/local/${name}`;

    return {
      [`${basePath}/health`]: {
        get: {
          responses: {
            200: {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { status: { const: 'ok' } },
                    required: ['status'],
                  },
                },
              },
            },
          },
        },
      },
      [`${basePath}/items`]: {
        get: {
          parameters: [
            {
              name: 'page',
              in: 'query',
              schema: { type: 'integer', minimum: 1, default: 1 },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, default: defaultListLimit },
            },
          ],
          responses: {
            200: {
              description: 'Current items',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      total: { type: 'integer', minimum: 0 },
                      count: { type: 'integer', minimum: 0 },
                      next: { type: ['string', 'null'], format: 'uri' },
                      prev: { type: ['string', 'null'], format: 'uri' },
                      results: { type: 'array', items: listItemSchema },
                    },
                    required: ['total', 'count', 'next', 'prev', 'results'],
                  },
                },
              },
            },
            400: { description: 'Invalid page or limit' },
          },
        },
      },
      [`${basePath}/items/{id}`]: {
        get: {
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              description: 'The item unique ID',
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: {
              description: 'Current item',
              content: { 'application/json': { schema: itemSchema } },
            },
            404: { description: 'Item not found' },
          },
        },
      },
      [`${basePath}/sync`]: {
        post: {
          description:
            'Sync the supplied URLs using existing scripts. Returns created and updated items ' +
            'and per-URL outcomes; individual run failures do not abort other URLs. ' +
            'Unchanged items refresh lastSeenAt without appearing in updated. Items are never removed.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: z.toJSONSchema(syncSchema) } },
          },
          responses: {
            200: {
              description: 'Item changes and URL outcomes, including partial failures',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      created: { type: 'array', items: storedItemSchema },
                      updated: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: { before: storedItemSchema, after: storedItemSchema },
                          required: ['before', 'after'],
                        },
                      },
                      outcome: {
                        type: 'object',
                        properties: {
                          success: { type: 'array', items: urlSchema },
                          unhandled: { type: 'array', items: urlSchema },
                          errors: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: { url: { type: 'string' }, error: { type: 'string' } },
                              required: ['url', 'error'],
                            },
                          },
                        },
                        required: ['success', 'unhandled', 'errors'],
                      },
                    },
                    required: ['created', 'updated', 'outcome'],
                  },
                },
              },
            },
            400: {
              description:
                'Invalid JSON body; expected an object containing a urls array of strings',
              content: { 'application/json': { schema: errorSchema } },
            },
            500: {
              description: 'Service-level failure',
              content: { 'application/json': { schema: errorSchema } },
            },
          },
        },
      },
    };
  }

  register(app: Express): void {
    const { name } = this.dataService;
    const basePath = `/local/${name}`;

    app.get(`${basePath}/health`, (_req, resp) => {
      resp.json({ status: 'ok' });
    });
    app.get(`${basePath}/items`, async (req, resp, next) => {
      const page = parsePositiveInteger(req.query.page, 1);
      const limit = parsePositiveInteger(req.query.limit, defaultListLimit);
      if (page === null || limit === null) {
        resp.status(400).json({ error: 'page and limit must be positive integers' });
        return;
      }

      try {
        const { total, count, results } = await this.dataService.list({ limit, page });
        const pageUrl = (page: number): string => {
          const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
          url.searchParams.set('page', String(page));
          return url.href;
        };
        resp.json({
          total,
          count,
          next: page * limit < total ? pageUrl(page + 1) : null,
          prev: page > 1 ? pageUrl(page - 1) : null,
          results,
        });
      } catch (e) {
        next(e);
      }
    });
    app.get(`${basePath}/items/:id`, async (req, resp, next) => {
      try {
        const item = await this.dataService.detail(req.params.id);
        if (item === null) {
          resp.status(404).json({ error: 'Item not found' });
          return;
        }

        resp.json(item);
      } catch (e) {
        next(e);
      }
    });
    app.post(`${basePath}/sync`, async (req, resp, next) => {
      const parsed = syncSchema.safeParse(req.body);
      if (!parsed.success) {
        resp.status(400).json({ error: 'urls must be an array of strings' });
        return;
      }
      try {
        resp.json(await this.dataService.sync(parsed.data.urls));
      } catch (e) {
        next(e);
      }
    });
  }
}
