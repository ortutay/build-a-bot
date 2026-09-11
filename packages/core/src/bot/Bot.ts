import type { JSONSchema } from 'json-schema-to-ts';
import { log } from '../logger.js';
import { clip, srid } from '../util/index.js';

export type BotOptions = {
  check: (urls: string[]) => Promise<{ out: unknown; logs: any[] }>;
  itemSchema: JSONSchema;
  run: (urls: string[]) => Promise<{ out: unknown; logs: any[] }>;
  uniqueId: (item: unknown) => string;
};

export class Bot {
  checkFn: (urls: string[]) => Promise<{ out: unknown; logs: any[] }>;
  itemSchema: JSONSchema;
  runFn: (urls: string[]) => Promise<{ out: unknown; logs: any[] }>;
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

  async check(urls: string[]): Promise<boolean[]> {
    const { logs, out } = await this.checkFn(urls);
    log.debug(`Bot check gave logs: ${clip(logs)}`);
    if (!Array.isArray(out) || !out.every((val) => typeof val === 'boolean')) {
      throw new Error('Bot check must return an array of booleans');
    }

    return out;
  }

  async run(urls: string[], runId?: string): Promise<unknown> {
    runId ||= srid();
    const { out, logs } = await this.runFn(urls);
    log.debug(`Bot run gave logs: ${clip(logs)}`);
    this.logs[runId] = logs;
    return out;
  }

  getLogs(runId: string): any[] {
    return this.logs[runId];
  }
}
