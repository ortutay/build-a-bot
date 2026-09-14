import type { JSONSchema } from 'json-schema-to-ts';
import { z } from 'zod';
import { log } from '../logger.js';
import { clip, srid } from '../util/index.js';

export type BotOptions = {
  check: (url: string) => Promise<{ out: unknown; logs: any[] }>;
  itemSchema: JSONSchema;
  run: (url: string) => Promise<{ out: unknown; logs: any[] }>;
  uniqueId: (item: unknown) => string;
};

export class Bot {
  checkFn: (url: string) => Promise<{ out: unknown; logs: any[] }>;
  itemSchema: JSONSchema;
  runFn: (url: string) => Promise<{ out: unknown; logs: any[] }>;
  uniqueId: (item: unknown) => string;
  logs: Record<string, any[]>;

  constructor(options: BotOptions) {
    this.checkFn = options.check;
    this.itemSchema = options.itemSchema;
    this.runFn = options.run;
    if (typeof options.uniqueId !== 'function') {
      throw new Error('Bot requires a uniqueId function');
    }
    this.uniqueId = options.uniqueId;
    this.logs = {};
  }

  async check(url: string): Promise<boolean> {
    const { logs, out } = await this.checkFn(url);
    log.debug(`Bot check gave logs: ${clip(logs)}`);
    return z.boolean().parse(out);
  }

  async run(url: string, runId?: string): Promise<unknown[]> {
    runId ||= srid();
    this.logs[runId] = [];
    const { out, logs } = await this.runFn(url);
    log.debug(`Bot run gave logs: ${clip(logs)}`);
    this.logs[runId] = logs;
    return z.array(z.unknown()).parse(out);
  }

  getLogs(runId: string): any[] {
    return this.logs[runId];
  }
}
