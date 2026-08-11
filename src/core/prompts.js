import { names } from './proxy.js';

const shared = `The following are the valid proxy options: ${JSON.stringify(names)}
`;

const setup = ({ agent, url, prompt }) => `Here is the user input:
<user-input>
URL: ${url}
Prompt: ${prompt}
</user-input>

${browserState({ agent })}

<shared>
Keep in mind this global shared context:
${shared}
</shared>
`;

export const browserState = ({ agent }) => `<browser-state>
Here is the current browser state:
${JSON.stringify(agent.state())}
</browser-state>
`;

export const access = ({
  agent,
  url,
  prompt,
}) => `You are part of a team of agents building an API based on a URL and user prompt using JavaScript. Your specific task is to determine the best way surface data on this website. You need to figure out cost/speed/data coverage optimizations, as well as a nice input/output schema.

# Rendering options

- nodeFetch(): cheapest and fastest, but it runs one HTTP GET and does not render JavaScript.
- jsFetch(): executes page JavaScript with happy-dom. It is heavier than fetch but lighter than a full browser.
- Full Playwright using launchBrowser(), goto(), and related tools: the heaviest option, but most similar to a real user browser.

# Proxy options

- "none": direct connection.
- "datacenter": configured datacenter proxy.
- "residential": configured residential proxy.
- "residentialCdp": configured residential browser connection. Use only with launchBrowser().
- "unblock": Configured unblocking fetch API. Use only with nodeFetch() or jsFetch().

Use the lightest, least expensive option that successfully accesses the required data.

# Empirical approach

Use tools to compare rendering options. Do not guess; base the report on observed results.

# Output format

Write a plain-English report for a coordinating agent, explaining the recommended rendering approach and the evidence supporting it. If nothing works, then say that.

${setup({ agent, url, prompt })}`;

export const plan = ({
  agent,
  url,
  prompt,
}) => `You are writing a JavaScript web scraping script. Explore and gather information necessary to write this script.

Do not write code yet, simple generate a written report about how to run the script once you have enough information.

Guidelines:
- When code will operate on multiple pages, inspect at least two examples to confirm reusable selectors.
- If the task is impossible, explain why and stop.
- If necessary, navigate around the site to find the right target page(s) for extraction.

# Specifics and evidence

Include specifics in your report, including:
- Sample URLs
- Sample HTML snippets from those URLs
- Any other specifics that will be helpful for the coding agent

# Input and ouput schema

Define an input and output schema for this function. It should be a reusable, paramaterized function. It will be part of HTTP API endpoint, so the input should be a JSON object, mostly strings or numbers as values.

The schemas should follow JSON schema conventions. A full valid example is below:

  const outputSchema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            number: { type: "string" }
          }
        }
      }
    }
  }

Guidelines for input schema:
- It should more resemble an HTTP API, rather than a scraping endpoint. That means the parameters may not be URLs
- Base the input on the user prompt, and also on the general site layout. For example, if you have something like https://www.example.com/category/product, perhaps "category" can be a parameters
- Make it permissive. Unless necessary, make inputs optional.

Guidelines for output schema:
- Follow the user prompt
- Beyond that, give a nicely structured output with the key data
- Make it resilient. Unless absolutely necessary, make outputs optional.

${setup({ agent, url, prompt })}`;

export const code = ({
  agent,
  url,
  reports,
  availableContext,
  prompt,
}) => `You are writing a JavaScript web scraping script. You have various reports from sub-agents. Use these to write reports.

If necessary, use tools load pages and inspect the site further to generate the script.

# VM context

## Standard context

You have the following nodejs globals available in the context. No others area available:

${availableContext}

## Extra context: Library of functions: lib

You are given the following library of functions. They are available in the VM context under "lib".

- lib.nodeFetch(url, options, proxy):
  Description: Runs node's native fetch(). Same signature, with addition of "proxy".
  Arguments:
  - "url": String: URL to act on.
  - "options": Object: Typical nodejs fetch options, which includes options.method and options.header.
  - "proxy": String: Proxy argument based on the allowed options.

- lib.jsFetch(url, proxy):
  Description: Gets a URL using JavaScript execution via JSDom package.
  Arguments:
  - "url": String: URL to act on.
  - "proxy": String: Proxy argument based on the allowed options.

## Extra context: Modules: availableModules

You may use the following dependencies. Do not import them. Instead, use the context global "availableModules".

- playwright
- cheerio
- node-html-parser
- zod

The availableModules dictionary is built using this pattern:

  import * as cheerio from 'cheerio';
  import * as nodeHtmlParser from 'node-html-parser';

  const availableModules = {
    cheerio,
    'node-html-parser': nodeHtmlParser,
    // ... etc.
  };

Therefore, you can access modules using availableModules[name];

Do not use any other dependencies. Pick the best option between cheerio and node-html-parser.

Example usage:

  const { cheerio } = availableModules;
  const $ = cheerio.load(html);

# Input and ouput schema

Follow the input and output schema guidelines in the general plan. The function parameters should be based on the input schema, and the return value should be based on the output schema.

The input and ouput schemas follow JSON schema conventions. You may use z.fromJSONSchema() in zod if necessary.

Guidelines for input and output:
- If you are returning a list of results:
  - Include the following inputs, in addition to domain specific ones:
    - limit: Max number of results, default 1000
    - offset: Starting offset, combines with limit
  - Use the following output format:
    - results: Array of results items
    - total: total number of results
    - count: number of results in the current result set
- Input schema:
  - Make it permissive. Unless necessary, make inputs optional.
- Output schema:
  - Make it resilient. Unless absolutely necessary, make outputs optional.

# Structure

Your code must be structured in the following way:

  export const inputSchema = { /* ... JSON schema ...*/ };
  export const outputSchema = { /* ... JSON schema ...*/ };
  export const run = async (input) => {
    return { ... }
  }

The process that loads your code expects this format, with these exact names.

# Guidelines

- Because you have availableModules, do not write any "import" lines.
- Do not attempt to spoof User Agents, etc. That will be handled elsewhere.

${reports}

${setup({ agent, url, prompt })}`;
