import { type Express } from 'express';
import { z } from 'zod';
import { DataService, defaultListLimit } from '@build-a-bot/core';

export type DataServiceAPIOptions = { dataService: DataService };

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
    const { name } = this.dataService;

    return {
      [`/${name}/health`]: {
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
      [`/${name}/items`]: {
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
                      count: { type: 'integer', minimum: 0 },
                      total: { type: 'integer', minimum: 0 },
                      results: { type: 'array', items: listItemSchema },
                    },
                    required: ['results', 'count', 'total'],
                  },
                },
              },
            },
            400: { description: 'Invalid page or limit' },
          },
        },
      },
      [`/${name}/items/{id}`]: {
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
    };
  }

  register(app: Express): void {
    const { name } = this.dataService;

    app.get(`/${name}/health`, (_req, resp) => {
      resp.json({ status: 'ok' });
    });
    app.get(`/${name}/items`, async (req, resp, next) => {
      const page = parsePositiveInteger(req.query.page, 1);
      const limit = parsePositiveInteger(req.query.limit, defaultListLimit);
      if (page === null || limit === null) {
        resp.status(400).json({ error: 'page and limit must be positive integers' });
        return;
      }

      try {
        resp.json(await this.dataService.list({ limit, page }));
      } catch (e) {
        next(e);
      }
    });
    app.get(`/${name}/items/:id`, async (req, resp, next) => {
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
  }
}
