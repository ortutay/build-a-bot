import type { JSONSchema } from 'json-schema-to-ts';
import { srid, clip } from '../util/index.js';
import { log } from '../logger.js';

export type BotOptions = {
  fn: (input: unknown) => Promise<{ out: any; logs: any[] }>;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  exampleInput: unknown;
};

export class Bot {
  fn: (input: unknown) => Promise<{ out: any; logs: any[] }>;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  exampleInput: unknown;
  logs: Record<string, any[]>;

  constructor(options: BotOptions) {
    this.fn = options.fn;
    this.inputSchema = options.inputSchema;
    this.outputSchema = options.outputSchema;
    this.exampleInput = options.exampleInput;
    this.logs = {};
  }

  async run(input: unknown, runId?: string): Promise<unknown> {
    runId ||= srid();
    // TODO: input validation against input schema?
    const { out, logs } = await this.fn(input);
    log.debug(`Bot run gave logs: ${clip(logs)}`);
    this.logs[runId] = logs;
    return out;
  }

  getLogs(runId: string): any[] {
    return this.logs[runId];
  }
}
