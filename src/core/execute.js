import vm from 'node:vm';
import * as cheerio from 'cheerio';
import * as nodeHtmlParser from 'node-html-parser';
import * as playwright from 'playwright';
import * as zod from 'zod';
import { nodeFetch, jsFetch } from './fetchers';

const compile = (code) => {
  if (typeof code !== 'string') {
    throw new TypeError('Code must be a string.');
  }

  const source = code
    .replace(/^```[a-z]*/, '')
    .replace(/```$/, '')
    .replace(
      /\bexport\s+(?=(?:const|let|var|async\s+function|function|class)\b)/g,
      ''
    );

  if (/\bexport\b/.test(source)) {
    throw new Error(
      'The module must use named declarations for inputSchema, outputSchema, and run.'
    );
  }

  const final = `
    (async () => {
      'use strict';
      ${source}
      return {
        inputSchema: typeof inputSchema === 'undefined' ? undefined : inputSchema,
        outputSchema: typeof outputSchema === 'undefined' ? undefined : outputSchema,
        run: typeof run === 'undefined' ? undefined : run,
      };
    })()
  `;

  console.log('Final:', final);
  return final;
};

const parseWithSchema = async (schema, value, name) => {
  console.log(
    'x schema:',
    JSON.stringify(schema, null, 2),
    JSON.stringify(value, null, 2)
  );
  return zod.fromJSONSchema(schema).parseAsync(value);
};

export const execute = async (code, input) => {
  console.log('Execute:', input, code);

  const context = vm.createContext({
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

  // Object.assign(context, );
  // const script = new vm.Script(compileModule(code), { filename: 'execute.js' });

  const script = new vm.Script(compile(code), { filename: 'tmp.js' });

  const { inputSchema, outputSchema, run } = await script.runInContext(
    context,
    {
      timeout: 1000,
    }
  );

  if (typeof run !== 'function') {
    throw new TypeError('run must be an exported function.');
  }

  const parsedInput = await parseWithSchema(inputSchema, input, 'inputSchema');
  const result = await run(parsedInput);
  let out;
  try {
    out = await parseWithSchema(outputSchema, result, 'outputSchema');
  } catch (e) {
    console.warn('Got output validation error:', e);
    out = result;
  }
  return out;
};
