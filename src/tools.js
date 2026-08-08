import { Browser, BrowserErrorCaptureEnum } from 'happy-dom';
import { chromium } from 'playwright';
import {
  collapseHtml,
  defaultRemoveAttributes,
  defaultRemoveTags,
  drop,
  inspect,
  remove,
  slimHtml,
} from './html.js';

export class Tool {
  constructor(schema, fn) {
    this.schema = schema;
    this.fn = fn;
  }
}

export class ToolKit {
  constructor(tools) {
    this.tools = tools.map((tool) => tool.schema);
    this.mapping = Object.fromEntries(
      tools.map((tool) => [tool.schema.function.name, tool.fn])
    );
  }
}

const shared = {
  url: {
    type: 'string',
    description: 'URL to navigate to. Include the scheme, for example https://.',
  },
};

const noParameters = { type: 'object', properties: {}, required: [] };

const ensurePage = (agent) => {
  if (!agent.page) {
    throw new Error('No browser page is available. Call launchBrowser first.');
  }
  return agent.page;
};

const nodeFetch = new Tool(
  {
    type: 'function',
    function: {
      name: 'nodeFetch',
      description: 'Execute an HTTP GET using Node.js fetch.',
      parameters: {
        type: 'object',
        properties: { url: shared.url },
        required: ['url'],
      },
    },
  },
  async (_agent, { url }) => {
    const response = await fetch(url);
    return { status: response.status, html: slimHtml({ html: await response.text(), url }) };
  }
);

const jsFetch = new Tool(
  {
    type: 'function',
    function: {
      name: 'jsFetch',
      description: 'Execute an HTTP GET with JavaScript execution using happy-dom.',
      parameters: {
        type: 'object',
        properties: { url: shared.url },
        required: ['url'],
      },
    },
  },
  async (_agent, { url }) => {
    const browser = new Browser({
      settings: { errorCapture: BrowserErrorCaptureEnum.processLevel },
    });
    const page = browser.newPage();
    const response = await page.goto(url);
    await page.waitUntilComplete();
    return {
      status: response.status,
      html: slimHtml({ html: page.mainFrame.document.documentElement.outerHTML, url }),
    };
  }
);

const launchBrowser = new Tool(
  {
    type: 'function',
    function: {
      name: 'launchBrowser',
      description: 'Launch a plain Playwright browser. Required before browser page tools.',
      parameters: noParameters,
    },
  },
  async (agent) => {
    await agent.closeBrowser();
    agent.browser = await chromium.launch({ headless: true });
    agent.page = await agent.browser.newPage();
    return { url: agent.page.url() };
  }
);

const goto = new Tool(
  {
    type: 'function',
    function: {
      name: 'goto',
      description: 'Navigate the Playwright page to a URL.',
      parameters: {
        type: 'object',
        properties: { url: shared.url },
        required: ['url'],
      },
    },
  },
  async (agent, { url }) => {
    const response = await ensurePage(agent).goto(url);
    return { url: agent.page.url(), status: response?.status() };
  }
);

const fullContent = new Tool(
  {
    type: 'function',
    function: {
      name: 'fullContent',
      description: 'Get the full HTML contents of the page.',
      parameters: noParameters,
    },
  },
  async (agent) => ensurePage(agent).content()
);

const slimContent = new Tool(
  {
    type: 'function',
    function: {
      name: 'slimContent',
      description: 'Get cleaned HTML contents of the page for efficient inspection.',
      parameters: noParameters,
    },
  },
  async (agent) => {
    const page = ensurePage(agent);
    return {
      status: page.url() ? undefined : undefined,
      html: slimHtml({ html: await page.content(), url: page.url() }),
    };
  }
);

const collapsedContent = new Tool(
  {
    type: 'function',
    function: {
      name: 'content',
      description:
        'Get collapsed page HTML. Expand only required collapse IDs with shouldExpand, or use inspect for one region.',
      parameters: {
        type: 'object',
        properties: {
          shouldExpand: {
            type: 'object',
            description: 'Optional map of collapse IDs to expand.',
            additionalProperties: true,
          },
        },
        required: [],
      },
    },
  },
  async (agent, { shouldExpand } = {}) => {
    const html = await ensurePage(agent).content();
    return collapseHtml(
      remove(drop(html, 2, 8), defaultRemoveTags, defaultRemoveAttributes),
      shouldExpand
    );
  }
);

const inspectContent = new Tool(
  {
    type: 'function',
    function: {
      name: 'inspect',
      description: 'Get formatted HTML for one collapsed region.',
      parameters: {
        type: 'object',
        properties: { collapseId: { type: 'string', description: 'A collapse ID, such as d2.' } },
        required: ['collapseId'],
      },
    },
  },
  async (agent, { collapseId }) => inspect(await ensurePage(agent).content(), collapseId)
);

export const general = new ToolKit([
  nodeFetch,
  jsFetch,
  launchBrowser,
  goto,
  fullContent,
  slimContent,
  collapsedContent,
  inspectContent,
]);
