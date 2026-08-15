import type { JSONSchema } from 'json-schema-to-ts';

export type BotOptions = {
  fn: (input: unknown) => Promise<unknown>;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  exampleInput: unknown;
};

export class Bot {
  fn: (input: unknown) => Promise<unknown>;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  exampleInput: unknown;

  constructor(options: BotOptions) {
    this.fn = options.fn;
    this.inputSchema = options.inputSchema;
    this.outputSchema = options.outputSchema;
    this.exampleInput = options.exampleInput;
  }

  async run(input: unknown): Promise<unknown> {
    // TODO: input validation against input schema?
    return this.fn(input);
  }
}
