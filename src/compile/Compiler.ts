import chalk from 'chalk';
import * as vm from 'node:vm';
import * as cheerio from 'cheerio';
import * as nodeHtmlParser from 'node-html-parser';
import * as playwright from 'playwright';
import * as zod from 'zod';
import type { JSONSchema } from 'json-schema-to-ts';
import { Agent } from '@mastra/core/agent';
import { toContextTools } from './tool-fns.js';
import { log } from '../logger.js';
import { Bot } from '../bot/Bot.js';

type ZodJSONSchema = Parameters<typeof zod.fromJSONSchema>[0];

export type CompileResult = {
  fn: (input: unknown) => Promise<{ out: any; logs: any[] }>;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  exampleInput: unknown;
};

type CompileOptions = {
  additionalContext?: Record<string, unknown>;
};

export const availableModules = {
  cheerio,
  'node-html-parser': nodeHtmlParser,
  playwright,
  zod,
};

export const availableContext = {
  URL,
  URLSearchParams,
  AbortController,
  AbortSignal,
  TextEncoder,
  TextDecoder,

  // Useful general utilities
  structuredClone,
  queueMicrotask,
  performance,
  atob,
  btoa,
  Buffer,
  DOMException,

  setTimeout,
  clearTimeout,
  console,
};

const parseWithSchema = async (schema: JSONSchema, value: unknown): Promise<unknown> => {
  return zod.fromJSONSchema(schema as unknown as ZodJSONSchema).parseAsync(value);
};

export class Compiler {
  constructor() {}

  async compile(
    code: string,
    agent: Agent,
    { additionalContext = {} }: CompileOptions = {}
  ): Promise<CompileResult> {
    const sharedContext = {
      ...additionalContext,
      ...availableContext,
      tools: toContextTools(await agent.listTools()),
      ...availableModules,
    };
    const context = vm.createContext({ ...sharedContext });

    const cleaned = code
      .replace(/^```[a-z]*/, '')
      .replace(/```$/, '')
      .replace(/\bexport\s+(?=(?:const|let|var|async\s+function|function|class)\b)/g, '');

    const source = `
      (async () => {
      'use strict';
      ${cleaned}
      return {
      inputSchema: typeof inputSchema === 'undefined' ? undefined : inputSchema,
      outputSchema: typeof outputSchema === 'undefined' ? undefined : outputSchema,
      exampleInput: typeof exampleInput === 'undefined' ? undefined : exampleInput,
      run: typeof run === 'undefined' ? undefined : run,
      };
      })()
    `;

    const script = new vm.Script(source, { filename: 'script.js' });
    const { inputSchema, outputSchema, exampleInput } = await script.runInContext(context, {
      timeout: 1000,
    });

    const fn = async (input: unknown): Promise<{ out: any; logs: any[] }> => {
      const wrappedConsole: Record<string, any> = {};
      const logs: any[] = [];
      for (const key of Object.keys(console)) {
        wrappedConsole[key] = (...args: any[]) => {
          log.info(`${chalk.bgGray.bold('[BOT LOG]')}:`, ...args);
          logs.push({ level: key, args });
        };
      }

      const { run } = await script.runInContext(
        vm.createContext({ ...sharedContext, console: wrappedConsole }),
        {
          timeout: 1000,
        }
      );

      const parsedInput = await parseWithSchema(inputSchema!, input);
      const result = await run(parsedInput);
      let out;
      try {
        out = await parseWithSchema(outputSchema!, result);
      } catch (e) {
        log.warn(`Got output validation error: ${e instanceof Error ? e.message : e}`);
        out = result;
      }

      return { out, logs };
    };

    return { fn, inputSchema, outputSchema, exampleInput };
  }
}

export const toBot = async (
  code: string,
  agent: Agent,
  { additionalContext = {} }: CompileOptions = {}
): Promise<Bot> => {
  const compiler = new Compiler();
  return new Bot(await compiler.compile(code, agent, additionalContext));
};
