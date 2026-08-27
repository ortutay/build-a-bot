import type { z } from 'zod';
import { DataSource } from '../source/DataSource.js';
import { Service, Endpoint, ServiceOptions, StartServiceOptions } from './Service.js';
import { Workshop } from '../internal/index.js';

export type DataServiceOptions = ServiceOptions & {
  sources: DataSource[];
  itemSchema: z.ZodType;
  // TODO: optional hint?
};

export type StartDataServiceOptions = StartServiceOptions & {};

export type ScrapeDataOptions = {};

export class DataService extends Service {
  itemSchema: z.ZodType;
  sources: DataSource[];

  constructor(options: DataServiceOptions) {
    super(options);
    this.sources = options.sources;
    this.itemSchema = options.itemSchema;
  }

  get endpoints(): Endpoint[] {
    return [];
  }

  async build(): Promise<void> {
    console.log('Build data service:', this.itemSchema);

    for (const source of this.sources) {
      const ws = new Workshop();
      const bot = await ws.build({
        url: source.url,
        prompt: 'Build a scraper to get data in the output schema format.',
        // TODO: standardized input schema
        outputSchema: this.itemSchema,
      });

      console.log('Built a bot:', bot);
    }
  }
}
