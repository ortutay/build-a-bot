import { createTool, type Tool } from '@mastra/core/tools';
import type { JSONSchema } from 'json-schema-to-ts';
import { z } from 'zod';
import { log } from '../logger.js';
import type { AnyTool } from '../types.js';
import { clip, srid } from '../util/index.js';

export type BotOptions = {
  check: (url: string) => Promise<{ out: unknown; logs: any[] }>;
  itemSchema: JSONSchema;
  run: (url: string) => Promise<{ out: unknown; logs: any[] }>;
  uniqueId: (item: unknown) => string;
};

const botCheckToolInputSchema = z.object({
  url: z.string().describe('URL to scrape'),
});

const botCheckOutputSchema = z.boolean();

const botRunToolInputSchema = z.object({
  url: z.string().describe('URL to scrape'),
  runId: z.string().optional().describe('An ID for this run. It can be used to retrieve logs.'),
});

const botRunToolOutputSchema = z.array(z.unknown()).describe('Items extracted from the URL');

const botLogsToolInputSchema = z.object({
  runId: z.string().describe('The ID of the run whose logs to retrieve.'),
});

const botLogsToolOutputSchema = z.array(z.unknown()).describe('Logs from the bot run.');

export class Bot {
  itemSchema: JSONSchema;
  logs: Record<string, any[]>;
  uniqueId: (item: unknown) => string;
  checkFn: (url: string) => Promise<{ out: unknown; logs: any[] }>;
  runFn: (url: string) => Promise<{ out: unknown; logs: any[] }>;

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

  createCheckTool(
    id: string
  ): Tool<z.infer<typeof botCheckToolInputSchema>, z.infer<typeof botCheckOutputSchema>> {
    return createTool({
      id,
      description: 'Check if a URL is handled by this bot.',
      inputSchema: botCheckToolInputSchema,
      outputSchema: botCheckOutputSchema,
      execute: async ({ url }) => this.check(url),
    });
  }

  createRunTool(
    id: string
  ): Tool<z.infer<typeof botRunToolInputSchema>, z.infer<typeof botRunToolOutputSchema>> {
    return createTool({
      id,
      description: `Take a URL, and scrape it to generate items in the item schema: ${JSON.stringify(this.itemSchema)}`,
      inputSchema: botRunToolInputSchema,
      outputSchema: botRunToolOutputSchema,
      execute: async ({ url, runId }) => this.run(url, runId),
    });
  }

  createLogsTool(
    id: string
  ): Tool<z.infer<typeof botLogsToolInputSchema>, z.infer<typeof botLogsToolOutputSchema>> {
    return createTool({
      id,
      description: 'Get the logs associated with the specified run ID.',
      inputSchema: botLogsToolInputSchema,
      outputSchema: botLogsToolOutputSchema,
      execute: async ({ runId }) => this.getLogs(runId),
    });
  }

  createTools(prefix: string): Record<string, AnyTool> {
    const run = this.createRunTool(`${prefix}_run`);
    const check = this.createCheckTool(`${prefix}_check`);
    const logs = this.createLogsTool(`${prefix}_logs`);

    return {
      [run.id]: run,
      [check.id]: check,
      [logs.id]: logs,
    };
  }
}
