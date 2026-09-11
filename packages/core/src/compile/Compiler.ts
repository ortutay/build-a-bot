import * as vm from 'node:vm';
import chalk from 'chalk';
import * as cheerio from 'cheerio';
import type { JSONSchema } from 'json-schema-to-ts';
import * as nodeHtmlParser from 'node-html-parser';
import * as playwright from 'playwright';
import * as zod from 'zod';
import { log } from '../logger.js';

export type CompileResult = {
  check: (urls: string[]) => Promise<{ out: unknown; logs: any[] }>;
  fn: (input: unknown) => Promise<{ out: unknown; logs: any[] }>;
  outputSchema: JSONSchema;
  run: (urls: string[]) => Promise<{ out: unknown; logs: any[] }>;
  uniqueId: (item: unknown) => string;
};

export type CompileOptions = {
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

// TODO:
// 1) Constructor takes code, list of exports in that code, list of modules, list of tools
// 2) compile() takes no arguments, keep return type
export class Compiler {
  constructor() {}

  async compile(
    code: string,
    { additionalContext = {} }: CompileOptions = {}
  ): Promise<CompileResult> {
    const sharedContext = { ...additionalContext };
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
      outputSchema: typeof outputSchema === 'undefined' ? undefined : outputSchema,
      check: typeof check === 'undefined' ? undefined : check,
      run: typeof run === 'undefined' ? undefined : run,
      uniqueId: typeof uniqueId === 'undefined' ? undefined : uniqueId,
      };
      })()
    `;

    const script = new vm.Script(source, { filename: 'script.js' });
    const { check, outputSchema, run, uniqueId } = await script.runInContext(context, {
      timeout: 1000,
    });
    if (!outputSchema || typeof outputSchema !== 'object') {
      throw new Error('Script must export an outputSchema object');
    }
    if (typeof check !== 'function') {
      throw new Error('Script must export a check function');
    }
    if (typeof run !== 'function') {
      throw new Error('Script must export a run function');
    }
    if (typeof uniqueId !== 'function') {
      throw new Error('Script must export a uniqueId function');
    }
    const uniqueIdFn = (item: unknown): string => {
      const val = uniqueId(item);
      if (typeof val !== 'string' || !val) {
        throw new Error('Script uniqueId must return a non-empty string');
      }

      return val;
    };

    const execute = async (
      name: 'check' | 'run',
      urls: string[]
    ): Promise<{ out: unknown; logs: any[] }> => {
      const wrappedConsole: Record<string, any> = {};
      const logs: any[] = [];
      for (const key of Object.keys(console)) {
        wrappedConsole[key] = (...args: any[]) => {
          log.info(`${chalk.bgGray.bold('[BOT LOG]')}:`, ...args);
          logs.push({ level: key, args });
        };
      }

      const exports = await script.runInContext(
        vm.createContext({ ...sharedContext, console: wrappedConsole }),
        {
          timeout: 1000,
        }
      );
      const fn = exports[name];
      if (typeof fn !== 'function') {
        throw new Error(`Script must export a ${name} function`);
      }

      return { out: await fn(urls), logs };
    };

    const checkFn = (urls: string[]) => execute('check', urls);
    const runFn = (urls: string[]) => execute('run', urls);
    const fn = (input: unknown) => runFn(input as string[]);

    return { check: checkFn, fn, outputSchema, run: runFn, uniqueId: uniqueIdFn };
  }
}
