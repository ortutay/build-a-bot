import type { JSONSchema } from 'json-schema-to-ts';

export type Tool = {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONSchema;
  run(input: unknown): Promise<unknown>;
};
