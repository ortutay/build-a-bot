import { Agent } from '@mastra/core/agent';
import * as vm from 'node:vm';
import * as cheerio from 'cheerio';
import * as nodeHtmlParser from 'node-html-parser';
import * as playwright from 'playwright';
import * as zod from 'zod';
import type { JSONSchema } from 'json-schema-to-ts';

import { toContextTools } from './tool-fns.js';

export type CompileResult = {
  fn: (input: unknown) => Promise<unknown>;
  inputSchema: JSONSchema | undefined;
  outputSchema: JSONSchema | undefined;
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

const parseWithSchema = async (schema, value) => {
  return zod.fromJSONSchema(schema).parseAsync(value);
};

export class Compiler {
  constructor() {}

  async compile(code: string, agent: Agent): Promise<CompileResult> {
    const context = vm.createContext({
      ...availableContext,
      tools: toContextTools(await agent.listTools()),
      availableModules: {
        cheerio,
        'node-html-parser': nodeHtmlParser,
        playwright,
        zod,
      },
    });

    console.log('Context:', context);

    const cleaned = code
      .replace(/^```[a-z]*/, '')
      .replace(/```$/, '')
      .replace(
        /\bexport\s+(?=(?:const|let|var|async\s+function|function|class)\b)/g,
        ''
      );

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
    const { inputSchema, outputSchema, exampleInput, run } =
      await script.runInContext(context, {
        timeout: 1000,
      });

    const fn = async (input) => {
      const parsedInput = await parseWithSchema(inputSchema, input);
      const result = await run(parsedInput);
      let out;
      try {
        out = await parseWithSchema(outputSchema, result);
      } catch (e) {
        console.warn('Got output validation error:', e);
        out = result;
      }
      return out;
    };

    return { fn, inputSchema, outputSchema, exampleInput };
  }
}
