import { Template } from './Template.js';

export const userInput = new Template(
  ['url', 'goal'],
  `<user-input>
  <user-url>{{url}}</user-url>
  <user-goal>{{goal}}</user-goal>
</user-input>`
);

export const report = new Template(
  ['report'],
  `<report>
{{report}}
</report>`
);

export const toolsForCode = new Template(
  ['tools'],
  `<tool-instructions>
You have helper functions available, based on the tools below. You can call any of these tools like this:

    const output = await tools.toolNameHere({ ...tool input here... });

The tool name is its key in the mapping.

For example, if a tool has the key "weatherTool", call it like this:
    
    const output = await tools.weatherTool({ city: "New York City, NY' });

Tools:

<tool-list>
{{tools}}
</tool-list>

</tools-instructions>`
);

export const plan = new Template(
  ['userInput'],
  `You are writing a JavaScript web scraping script. Explore and gather information necessary to write this script.

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

{{userInput}}
`
);

export const code = new Template(
  ['toolsForCode', 'userInput', 'report'],
  `You are writing a JavaScript web scraping script. You have various reports from sub-agents. Use these to write reports.

If necessary, use tools load pages and inspect the site further to generate the script.

Guidelines for input and output:
- If you are returning a list of results:
  - Include the following inputs, in addition to domain specific ones:
    - limit: Max number of results, default 1000
    - offset: Starting offset, combines with limit
  - Use the following output format:
    - results: Array of results items
    - total: total number of results
    - count: number of results in the current result set
- If you are returning a single result:
  - Simply return the object itself
- Input schema:
  - Make it permissive. Unless necessary, make inputs optional.
  - Avoid putting the input URL as one of the fields in input schema. You can instead hardcode it, with the option to override if necessary.
  - Do not put default values on filter fields, or most other fields.
    - For example, a list endpoint should, by default, return everything, and filters should not have pre-defined defaults
  - For detail getter endpoints, the idenitifer can be required
    - For example, for https://example.com/products/:id, the :id field should be required
- Output schema:
  - Make it resilient. Unless absolutely necessary, make outputs optional.

# Structure

Your code must be structured in the following way:

  export const inputSchema = { /* ... JSON schema ...*/ };
  export const outputSchema = { /* ... JSON schema ...*/ };
  export const exampleInput = { /* ... JSON object that fits the input schema ...*/ };
  export const run = async (input) => {
    return { ... }
  }

The process that loads your code expects this format, with these exact names.

{{toolsForCode}}

# Dependencies

Do not use any dependencies, not even fetch(). Use the tools above instead.

# Guidelines

- Because you have availableModules, do not write any "import" lines.
- Do not attempt to spoof User Agents, etc. That will be handled elsewhere.

{{userInput}}

{{report}}
`
);
