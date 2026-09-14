import * as vm from 'node:vm';
import chalk from 'chalk';
import * as cheerio from 'cheerio';
import type { JSONSchema } from 'json-schema-to-ts';
import * as nodeHtmlParser from 'node-html-parser';
import PQueue from 'p-queue';
import * as playwright from 'playwright';
import * as zod from 'zod';
import { log } from '../logger.js';

export type CompileResult = {
  check: (url: string) => Promise<{ out: unknown; logs: any[] }>;
  fn: (input: unknown) => Promise<{ out: unknown; logs: any[] }>;
  itemSchema: JSONSchema;
  run: (url: string) => Promise<{ out: unknown; logs: any[] }>;
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

const wrapPQueue = (pq: PQueue, logger: Pick<Console, 'info'>): PQueue => {
  const add = pq.add.bind(pq);
  return new Proxy(pq, {
    get(target, key) {
      if (key !== 'add') {
        const val = Reflect.get(target, key, target);
        return typeof val === 'function' ? val.bind(target) : val;
      }

      return (...args: Parameters<PQueue['add']>) => {
        const [fn, options] = args;
        return add(async (taskOptions) => {
          logger.info(`Started bot script queue task: queued=${pq.size}, running=${pq.pending}`);
          return await fn(taskOptions);
        }, options);
      };
    },
  });
};

export class Compiler {
  constructor() {}

  async compile(
    code: string,
    { additionalContext = {} }: CompileOptions = {}
  ): Promise<CompileResult> {
    const pq = new PQueue({ concurrency: 50, intervalCap: 5, interval: 1000, strict: true });
    const sharedContext = { ...additionalContext, pq };
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
      itemSchema: typeof itemSchema === 'undefined' ? undefined : itemSchema,
      check: typeof check === 'undefined' ? undefined : check,
      run: typeof run === 'undefined' ? undefined : run,
      uniqueId: typeof uniqueId === 'undefined' ? undefined : uniqueId,
      };
      })()
    `;

    const script = new vm.Script(source, { filename: 'script.js' });
    const { check, itemSchema, run, uniqueId } = await script.runInContext(context, {
      timeout: 1000,
    });
    if (!itemSchema || typeof itemSchema !== 'object') {
      throw new Error('Script must export an itemSchema object');
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
      input: unknown
    ): Promise<{ out: unknown; logs: any[] }> => {
      const wrappedConsole = {} as Pick<Console, 'info'> & Record<string, any>;
      const logs: any[] = [];
      for (const key of Object.keys(console)) {
        wrappedConsole[key] = (...args: any[]) => {
          log.info(`${chalk.bgGray.bold('[BOT LOG]')}:`, ...args);
          logs.push({ level: key, args });
        };
      }

      const exports = await script.runInContext(
        vm.createContext({
          ...sharedContext,
          console: wrappedConsole,
          pq: wrapPQueue(pq, wrappedConsole),
        }),
        {
          timeout: 1000,
        }
      );
      const fn = exports[name];
      if (typeof fn !== 'function') {
        throw new Error(`Script must export a ${name} function`);
      }

      return { out: await fn(input), logs };
    };

    const checkFn = (url: string) => execute('check', url);
    const runFn = (url: string) => execute('run', url);
    const fn = (input: unknown) => execute('run', input);

    return { check: checkFn, fn, itemSchema, run: runFn, uniqueId: uniqueIdFn };
  }
}
