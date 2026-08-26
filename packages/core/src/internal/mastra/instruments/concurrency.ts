import * as z from 'zod';
import { type Tool } from '@mastra/core/tools';
import PQueue from 'p-queue';
import { log } from '../../logger.js';
import { asJSONSchema } from './shared.js';

export const concurrencyInstrument = async (tool: Tool): Promise<Tool> => {
  if (
    tool.inputSchema === undefined ||
    tool.inputSchema == null ||
    tool.outputSchema === undefined ||
    tool.outputSchema == null
  ) {
    return tool;
  }

  const inputSchema = z.fromJSONSchema(asJSONSchema(tool.inputSchema, 'input'));
  const outputSchema = z.fromJSONSchema(asJSONSchema(tool.outputSchema, 'output'));

  const concurrencyInputSchema = z.object({
    arguments: z.array(
      inputSchema.describe(
        'One or more argument sets to pass to the underlying tool. They will be executed concurrently, based on the limits in the concurrency input.'
      )
    ),
    concurrency: z
      .object({
        limit: z
          .number()
          .int()
          .positive()
          .describe('Maximum number of concurrent tool operations.'),
        intervalCap: z
          .number()
          .int()
          .positive()
          .describe('The max number of runs in the given interval of time.'),
        interval: z
          .number()
          .nonnegative()
          .describe(
            'The length of time in milliseconds before the interval count resets. Must be finite.'
          ),
        distribution: z
          .enum(['random', 'burst'])
          .default('burst')
          .describe(
            'Whether to spread requests randomly across the interval or send them as soon as possible.'
          ),
      })
      .describe('Concurrency limits when executing the arguments.'),
  });

  const concurrencyOutputSchema = z.object({
    results: z.array(
      outputSchema.describe(
        'The outputs for each concurrent execution, give in the same order as the arguments list. The length of results will exactly match the length of arguments input.'
      )
    ),
  });

  return {
    ...tool,
    inputSchema: concurrencyInputSchema,
    outputSchema: concurrencyOutputSchema,
    execute: async (input, context) => {
      const { arguments: argumentsList, concurrency } = input as ConcurrencyInput;
      const queue = new PQueue({
        concurrency: concurrency.limit,
        intervalCap: concurrency.intervalCap,
        interval: concurrency.interval,
      });

      log.info(
        `Running concurrently ${tool.id}: limit=${concurrency.limit}, interval=${concurrency.interval}msec/${concurrency.distribution}, cap=${concurrency.intervalCap}`
      );

      const results = await Promise.all(
        argumentsList.map(async (arguments_) => {
          if (concurrency.distribution === 'random') {
            await delay(Math.random() * concurrency.interval);
          }
          return queue.add(() => tool.execute?.(arguments_, context));
        })
      );

      return { results };
    },
  };
};

type ConcurrencyInput = {
  arguments: unknown[];
  concurrency: {
    limit: number;
    intervalCap: number;
    interval: number;
    distribution: 'random' | 'burst';
  };
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
