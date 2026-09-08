import { Template } from './Template.js';

const guidelineDoNotInvent =
  'Do not invent or guess at CSS selectors, element IDs, etc. Base your selectors and locators only on what you have actually seen.';

const guidelinePlaywrightStrictMode =
  'Browser click locators use Playwright strict mode: make each selector match exactly one inspected element whenever possible. Use an index only to disambiguate inspected matches whose order is stable.';

const guidelineTestSnippets =
  'As appropriate, test your assumptions by running small JavaScript snippets using the available tool for that.';

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
  ['userInput', 'inputSchema', 'outputSchema'],
  `You are writing a JavaScript web scraping bot. Explore and gather information necessary to write this script.

Do not write code yet. Generate a written report about how to run the script once you have enough information, along with input and output schemas. If a schema was supplied, repeat it exactly. If it was not supplied, generate it from the user goal and your research. Return each schema as a JSON-encoded string without Markdown fences.

Guidelines:
- When code will operate on multiple pages, inspect at least two examples to confirm reusable selectors.
- ${guidelinePlaywrightStrictMode}
- ${guidelineTestSnippets}
- If the task is impossible, explain why and stop.
- If necessary, navigate around the site to find the right target page(s) for extraction.
  - The goal is to make a reusable bot based on the user input. Therefore, if he gave an example of a specific URL to scrape, does that URL fit into a general pattern? Can it be paramaterized? Eg. https://example.com/tvs/sony-z-100 could become https://example.com/:category/:id, with category and id as inputs.

# Format considerations

Decide what format you want to fetch for each URL. Use slim HTML for efficient inspection and full HTML only when necessary for structured data extraction.

Put this in a section titled "Format report"

# Runtime considerations

Compare runtimes of various tools. Include this information in your report. When possible, your goal is to minimize runtime, while also considering data accessibility and reliability.

Try the different providers and various tools to gather evidence for fastest runtime. Put this data in a section titled "Runtime report".

# Cost considerations

Compare costs of various tools. Include this information in your report. When possible, your goal is to minimize cost, while also considering data accessibility and reliability.

Try the different providers and various tools to gather evidence for fastest cost. Put this data in a section titled "Cost report".

# Proxy considerations

Try different proxy settings, starting with lowest weight solutions.

# Specifics and evidence

Include specifics in your report, including:
- Sample URLs
- Sample HTML snippets from those URLs
- Relevant selectors for all fields in output schema.
- Any other specifics that will be helpful for the coding agent

Give enough HTML snippets to write the proper selectors.

# Snippets

If tools are available, test your assumptions using snippets. You may include small code snippets that worked in the report output as appropriate.

# Input and ouput schema

Define an input and output schema for this function. It should be a reusable, parameterized function. It will be part of an HTTP API endpoint, so the input should be a JSON object, mostly strings or numbers as values.

If the user input includes an input or output schema, it is authoritative. Do not add fields, wrappers, or metadata that are not present in the supplied schema.

Guidelines for input schema:
- Follow the user prompt
- It should more resemble an HTTP API, rather than a scraping endpoint. That means the parameters may not be URLs
- Base the input on the user prompt, and also on the general site layout. For example, if you have something like https://www.example.com/category/product, perhaps "category" can be a parameters
- Make it permissive. Unless necessary, make inputs optional.
- Avoid restricting inputs unecessarily. This means avoiding unecessary enum restritions. Only use those when you are sure there is a limited set of inputs that will work. Do not put in overly large enum lists (~10 should be the most you put in, beyond that just accept any string)
- Keep input schema flat, unless there is good reason for nesting.
- Do not include fields for proxy selection. That should be handled internally.
- If a specific input schema is provided in the user prompt section, ignore above guidelines and use the user's input schema. Restate the user schema in your output.

Guidelines for output schema:
- Follow the user prompt
- Beyond that, give a nicely structured output with the key data
- Make it resilient. Unless absolutely necessary, make outputs optional.
- Do not overcomplicate the schema or add excessive nesting.
- If a specific output schema is provided in the user prompt section, use it exactly. Restate the user schema in your output.

# Additional guidelines

- The eventual script will be run in a node.js VM context, with specific modules made available, along with the tools you have
- For exampleInput, if there is a "limit", set it to 10
- Do not suggest tools that were not available to you. The execution environment will have the exact same tools.
- The fetch tools already handle robots.txt rules. You can call them at any rate limit, and robots.txt handling is applied upstream.
- ${guidelineDoNotInvent}
- ${guidelinePlaywrightStrictMode}
- ${guidelineTestSnippets}

# Report summary

- At the end of your report, include a brief summary of your findings. This is also where you should call out errors or problems that may prevent the task from being feasible.
- If multiple approaches are possible, describe them, and give your recommendation. For example, you may have one approach based on direct page loads, and another based on direct requests to the backend API.

<== Begin User Input Section ==>

{{userInput}}

<input-schema>
{{inputSchema}}
</input-schema>

<output-schema>
{{outputSchema}}
</output-schema>

<== End User Input Section ==>

`
);

export const consolidateIntoPlan = new Template(
  ['reports', 'userInput'],
  `Examine the reports below on how to scrape a use site given some user input. Consolidate the reports into a single recommendations on how to write the scraper.

Keep the same level of details and precision as the original reports. The next step in this workflow will write code, so it will need precision and details.

{{reports}}

{{userInput}}
`
);

export const code = new Template(
  [
    'toolsForCode',
    'availableModules',
    'availableContext',
    'userInput',
    'inputSchema',
    'outputSchema',
    'report',
  ],
  `You are writing a JavaScript web scraping script. You have various reports from sub-agents. Use these to write reports.

If necessary, use tools load pages and inspect the site further to generate the script.

The input and output schemas below are authoritative. Export them exactly, and ensure that exampleInput and the value returned from run() conform to them. Do not add wrappers, pagination fields, or metadata that are absent from the supplied schemas.

Export a synchronous uniqueId(result) function that returns a stable, non-empty, 12-character digest for every result. Select and normalize the strongest durable identifier components for the kind of item: an email address for a person, a product ID or canonical product URL for commerce, and similarly stable IDs for other domains. For example, trim and lowercase email addresses or normalize absolute URLs. Hash those normalized components with a deterministic synchronous hash implemented in the generated code, then return its 12-character digest. Do not use mutable labels, timestamps, random values, array positions, or unavailable crypto APIs. If no domain identifier exists, prefer a normalized URL or email address.

Guidelines for input schema:
  - Make it permissive. Unless necessary, make inputs optional.
  - Often, there should be zero or one (or may be two) "main" inputs, and the rest are supplementary filters, etc.
  - Avoid putting the input URL as one of the fields in input schema. You can instead hardcode it, with the option to override if necessary.
  - Do not put default values on filter fields, or most other fields.
    - For example, a list endpoint should, by default, return everything, and filters should not have pre-defined defaults
  - For detail getter endpoints, the idenitifer can be required
    - For example, for https://example.com/products/:id, the :id field should be required

<input-schema>
{{inputSchema}}
</input-schema>

<output-schema>
{{outputSchema}}
</output-schema>

# Structure

Your code must be structured in the following way:

  export const inputSchema = { /* ... JSON schema ...*/ };
  export const outputSchema = { /* ... JSON schema ...*/ };
  export const exampleInput = { /* ... JSON object that fits the input schema ...*/ };
  export const uniqueId = (result) => { /* ... return a canonical string ... */ };
  export const run = async (input) => {
    return { ... }
  }

The process that loads your code expects this format, with these exact names.

{{toolsForCode}}

# Available nodejs modules

You have access to these modules, which are in the VM context. Do not import them, simply use them if needed.

{{availableModules}}

# Available context

You have access to these globals in the VM context

{{availableContext}}

# Dependencies

- Use only the modules, context, and tools from above. 
- Do not import or require anything, they are already in the context.

# Report

Below is the research report. Follow guidances in the report, including runtime, and cost considerations. Balance cost and runtime in a way developers would like.

{{report}}

# Comments

Begin your code with comments summarizing report findings briefly, including relevant format considerations, selectors, rate limits, provider, cost and runtime recommendations, as well as any other considerations.

# Debug output

Send debug output via console.log() as you go along. Log items as they are parsed, URLs you visit, and key points in the scraping.

# Additional guidelines

- Because you have availableModules, do not write any "import" lines.
- Do not attempt to spoof User Agents, etc. That will be handled elsewhere.
- Try to make the example input something that runs on the faster side
  - If example input includes a limit, set it to 10
- The fetch tools already handle robots.txt rules. You can call them at any rate limit, and robots.txt handling is applied upstream
- ${guidelineDoNotInvent}
- ${guidelinePlaywrightStrictMode}
- ${guidelineTestSnippets}

{{userInput}}

`
);

// # Concurrency and rate limit considerations

// Evaluate concurrency and rate limits for URL retrieval by try different concurrency configurations. First try low concurrency and low rate limit. Then, try higher values.

// Rate limit progression:
//   - First, try 1 query by itself
//   - Then, try around 10 queries at ~5qps, max concurrency = 5
//   - Then, try around 20 queries at ~10qps, max concurrency = 10

// Beyond this, use your judgement.

// Try the different providers and various tools to gather evidence for concurrency and rate limits on a per-provider basis. Put this data in a section titled "Concurrency and rate limit report".
