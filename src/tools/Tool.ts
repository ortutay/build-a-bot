import type { FromSchema, JSONSchema } from 'json-schema-to-ts';
import { log } from '../logger.js';

type Awaitable<T> = T | Promise<T>;

type ToolParameter = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
};

export class Tool<Input extends JSONSchema, Output extends JSONSchema> {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly parameters: Input,
    public readonly returns: Output,
    public readonly fn: (
      input: FromSchema<Input>
    ) => Awaitable<FromSchema<Output>>
  ) {}

  async run(input: Input) {
    log.info(`Run tool "${this.name}" on:`, input);
    return this.fn(input);
  }

  get asParameter(): ToolParameter {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}
