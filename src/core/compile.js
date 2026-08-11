import vm from 'node:vm';
import * as cheerio from 'cheerio';
import * as nodeHtmlParser from 'node-html-parser';
import * as playwright from 'playwright';
import * as zod from 'zod';
import { nodeFetch, jsFetch } from './fetchers.js';

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

export const compile = async (code) => {
  const context = vm.createContext({
    ...availableContext,
    lib: {
      nodeFetch,
      jsFetch,
    },
    availableModules: {
      cheerio,
      'node-html-parser': nodeHtmlParser,
      playwright,
      zod,
    },
  });

  if (typeof code !== 'string') {
    throw new TypeError('Code must be a string.');
  }

  const cleaned = code
    .replace(/^```[a-z]*/, '')
    .replace(/```$/, '')
    .replace(
      /\bexport\s+(?=(?:const|let|var|async\s+function|function|class)\b)/g,
      ''
    );

  if (/\bexport\b/.test(cleaned)) {
    throw new Error(
      'The module must use named declarations for inputSchema, outputSchema, and run.'
    );
  }

  const source = `
    (async () => {
      'use strict';
      ${cleaned}
      return {
        inputSchema: typeof inputSchema === 'undefined' ? undefined : inputSchema,
        outputSchema: typeof outputSchema === 'undefined' ? undefined : outputSchema,
        run: typeof run === 'undefined' ? undefined : run,
      };
    })()
  `;

  const script = new vm.Script(source, { filename: 'script.js' });
  const { inputSchema, outputSchema, run } = await script.runInContext(
    context,
    {
      timeout: 1000,
    }
  );

  if (typeof run !== 'function') {
    throw new TypeError('run must be an exported function.');
  }

  return async (input) => {
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
};
