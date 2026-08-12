import { Browser, BrowserErrorCaptureEnum } from 'happy-dom';
import type { FromSchema } from 'json-schema-to-ts';
import { proxyFetch } from '../proxy.js';
import { Tool } from './Tool.js';
import * as shared from './parameters.js';

const inputSchema = {
  type: 'object',
  properties: {
    url: shared.url,
    proxy: shared.proxy,
  },
  required: ['url'],
  additionalProperties: false,
} as const;

const outputSchema = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    ok: { type: 'boolean' },
    status: { type: 'number' },
    statusText: { type: 'string' },
    headers: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    body: { type: 'string' },
  },
  required: ['url', 'ok', 'status', 'statusText', 'headers', 'body'],
  additionalProperties: false,
} as const;

type Input = FromSchema<typeof inputSchema>;
type Output = FromSchema<typeof outputSchema>;

const fn = async (input: Input): Promise<Output> => {
  const browser = new Browser({
    settings: {
      errorCapture: BrowserErrorCaptureEnum.processLevel,
      fetch: {
        interceptor: {
          beforeAsyncRequest: async ({ request, window }) => {
            const resp = await proxyFetch(
              request.url,
              input.proxy,
              request.headers
            );
            return new window.Response(await resp.text(), {
              status: resp.status,
              statusText: resp.statusText,
              headers: Object.fromEntries(resp.headers),
            });
          },
        },
      },
    },
  });
  const page = browser.newPage();
  const resp = await page.goto(input.url);

  if (!resp) {
    throw new Error(`Could not navigate to ${input.url}.`);
  }

  await page.waitUntilComplete();
  return {
    url: resp.url,
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    headers: Object.fromEntries(resp.headers),
    body: page.mainFrame.document.documentElement.outerHTML,
  };
};

export const jsFetchTool = new Tool(
  'jsFetchTool',
  `Fetch a URL with JavaScript execution using happy-dom`,
  inputSchema,
  outputSchema,
  fn
);
