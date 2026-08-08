import { Browser, BrowserErrorCaptureEnum } from "happy-dom";
import { chromium } from "playwright";
import {
  collapseHtml,
  defaultRemoveAttributes,
  defaultRemoveTags,
  drop,
  inspect,
  remove,
  slimHtml,
} from "./html.js";
import { getProxySpec, proxyFetch } from "./proxy.js";

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
      tools.map((tool) => [tool.schema.function.name, tool.fn]),
    );
  }
}

const shared = {
  url: {
    type: "string",
    description:
      "URL to navigate to. Include the scheme, for example https://.",
  },
  proxy: {
    type: "string",
    enum: ["none", "datacenter", "residential", "residentialCdp", "unblock"],
    description:
      'One of: "none", "datacenter", "residential", "residentialCdp", or "unblock".',
  },
};

const noParameters = { type: "object", properties: {}, required: [] };

const ensurePage = (agent) => {
  if (!agent.page) {
    throw new Error("No browser page is available. Call launchBrowser first.");
  }
  return agent.page;
};

const nodeFetch = new Tool(
  {
    type: "function",
    function: {
      name: "nodeFetch",
      description: "Execute an HTTP GET using Node.js fetch.",
      parameters: {
        type: "object",
        properties: { url: shared.url, proxy: shared.proxy },
        required: ["url", "proxy"],
      },
    },
  },
  async (_agent, { url, proxy }) => {
    const response = await proxyFetch(url, proxy);
    return {
      status: response.status,
      html: slimHtml({ html: await response.text(), url }),
    };
  },
);

const jsFetch = new Tool(
  {
    type: "function",
    function: {
      name: "jsFetch",
      description:
        "Execute an HTTP GET with JavaScript execution using happy-dom.",
      parameters: {
        type: "object",
        properties: { url: shared.url, proxy: shared.proxy },
        required: ["url", "proxy"],
      },
    },
  },
  async (_agent, { url, proxy }) => {
    const browser = new Browser({
      settings: {
        errorCapture: BrowserErrorCaptureEnum.processLevel,
        fetch: {
          interceptor: {
            beforeAsyncRequest: async ({ request, window }) => {
              const response = await proxyFetch(
                request.url,
                proxy,
                request.headers,
              );
              return new window.Response(await response.text(), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            },
          },
        },
      },
    });
    const page = browser.newPage();
    const response = await page.goto(url);
    await page.waitUntilComplete();
    return {
      status: response.status,
      html: slimHtml({
        html: page.mainFrame.document.documentElement.outerHTML,
        url,
      }),
    };
  },
);

const launchBrowser = new Tool(
  {
    type: "function",
    function: {
      name: "launchBrowser",
      description:
        "Launch a plain Playwright browser. Required before browser page tools.",
      parameters: {
        type: "object",
        properties: { proxy: shared.proxy },
        required: ["proxy"],
      },
    },
  },
  async (agent, { proxy }) => {
    const spec = getProxySpec(proxy);
    await agent.closeBrowser();

    if (spec.fetch) {
      throw new Error(
        'Proxy tier "unblock" is only available to nodeFetch and jsFetch.',
      );
    }

    if (spec.cdp) {
      agent.browser = await chromium.connectOverCDP(spec.cdp, {
        timeout: 60_000,
      });
      agent.context =
        agent.browser.contexts()[0] || (await agent.browser.newContext());
    } else {
      agent.browser = await chromium.launch({
        headless: true,
        ...(spec.server ? { proxy: spec } : {}),
      });
      agent.context = await agent.browser.newContext();
    }

    agent.page = await agent.context.newPage();
    return { url: agent.page.url() };
  },
);

const goto = new Tool(
  {
    type: "function",
    function: {
      name: "goto",
      description: "Navigate the Playwright page to a URL.",
      parameters: {
        type: "object",
        properties: { url: shared.url },
        required: ["url"],
      },
    },
  },
  async (agent, { url }) => {
    const response = await ensurePage(agent).goto(url);
    return { url: agent.page.url(), status: response?.status() };
  },
);

const fullContent = new Tool(
  {
    type: "function",
    function: {
      name: "fullContent",
      description: "Get the full HTML contents of the page.",
      parameters: noParameters,
    },
  },
  async (agent) => ensurePage(agent).content(),
);

const slimContent = new Tool(
  {
    type: "function",
    function: {
      name: "slimContent",
      description:
        "Get cleaned HTML contents of the page for efficient inspection.",
      parameters: noParameters,
    },
  },
  async (agent) => {
    const page = ensurePage(agent);
    return {
      status: page.url() ? undefined : undefined,
      html: slimHtml({ html: await page.content(), url: page.url() }),
    };
  },
);

const collapsedContent = new Tool(
  {
    type: "function",
    function: {
      name: "content",
      description:
        "Get collapsed page HTML. Expand only required collapse IDs with shouldExpand, or use inspect for one region.",
      parameters: {
        type: "object",
        properties: {
          shouldExpand: {
            type: "object",
            description: "Optional map of collapse IDs to expand.",
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
      shouldExpand,
    );
  },
);

const inspectContent = new Tool(
  {
    type: "function",
    function: {
      name: "inspect",
      description: "Get formatted HTML for one collapsed region.",
      parameters: {
        type: "object",
        properties: {
          collapseId: {
            type: "string",
            description: "A collapse ID, such as d2.",
          },
        },
        required: ["collapseId"],
      },
    },
  },
  async (agent, { collapseId }) =>
    inspect(await ensurePage(agent).content(), collapseId),
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
