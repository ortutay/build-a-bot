import type { JSONSchema } from 'json-schema-to-ts';
import { log } from '../logger.js';

type Awaitable<T> = T | Promise<T>;

export class Tool {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly parameters: JSONSchema,
    public readonly returns: JSONSchema,
    public readonly fn: (input: any) => Awaitable<any>
  ) {}

  async run(input: unknown): Promise<unknown> {
    log.info(`Run tool "${this.name}" on:`, input);
    return this.fn(input);
  }
}
