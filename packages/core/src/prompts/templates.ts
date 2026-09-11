import { Template } from './Template.js';

const guidelineDoNotInvent =
  'Do not invent or guess at CSS selectors, element IDs, etc. Base your selectors and locators only on what you have actually seen.';

const guidelinePlaywrightStrictMode =
  'Browser click locators use Playwright strict mode: make each selector match exactly one inspected element whenever possible. Use an index only to disambiguate inspected matches whose order is stable.';

const guidelineTestSnippets =
  'As appropriate, test your assumptions by running small JavaScript snippets using the available tool for that.';

export const userInput = new Template(
  ['urls', 'goal'],
  `<user-input>
  <user-urls>{{urls}}</user-urls>
  <user-goal>{{goal}}</user-goal>
</user-input>`
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
  ['userInput', 'outputSchema'],
  `You are planning JavaScript web-scraping scripts for one data service. Explore and gather the information needed to write those scripts.

Do not write code yet. Produce a written implementation report for the coding agent and an output schema. If a schema was supplied, repeat it exactly. If it was not supplied, generate it from the user goal and your research. Return the schema as JSON without Markdown fences.

Guidelines:
- When code will operate on multiple pages, inspect at least two examples to confirm reusable selectors.
- ${guidelinePlaywrightStrictMode}
- ${guidelineTestSnippets}
- If necessary, navigate around the site to find the right target page(s) for extraction.
  - The goal is to make reusable scripts based on the user input. If a specific URL fits a general pattern, describe how it can be parameterized. For example, https://example.com/tvs/sony-z-100 could become https://example.com/:category/:id.

# URL groupings

## Interface

The data service receives runtime URLs like this:

  service.sync(["https://example.com/url1", "https://example-2.com/path", ...])

The service may own multiple scripts for different page types. At runtime, scripts use check(urls) to select URLs before they run.

Group the supplied seed URLs so that each grouping can be implemented by one script.

## Groupings instructions

You will receive at least one URL. Return one or more groupings.

Grouped URLs contain similar data, and can be parsed in a similar way. They often, but not always, have similar URL patterns. They often, but not always, have the same domain. They can always be parsed using the same script, for example because they share the same JSON-LD, or because they use the same server backend (like Shopify, WooCommerce, etc.), and therefore have similar site structures.

Sometimes, URLs will have the same pattern (https://www.example.com/key/:something), but page inspection will reveal that they are actually different, and must be parsed differently. In this case, put them in separate groupings.

Additionally, sometimes URLs will have a different pattern, but actually have the same structure. In this case, put them in a single grouping.

Every supplied URL must appear in exactly one grouping. Do not omit, duplicate, or add URLs.

Each groupingName is a descriptive label for a grouping in this plan. It must be non-empty, unique within the plan, kebab-case, and stable for the same page type.

Split the report into a general section, which applies to all groupings, and group-specific reports.

Include your analysis of groupings in a section called "Groupings report". Describe both URL patterns, page structures, and justify your groupings.

## Discerning URLs

The generated script's check(urls) function decides whether it can handle each URL. It should use URL structure and, when useful, lightweight page inspection. In your report, provide specific routing guidance and evidence for this check.

# Format considerations

Decide what format you want to fetch for each URL. Use slim HTML for efficient inspection and full HTML only when necessary for structured data extraction.

Put this in a section titled "Format report"

# Runtime considerations

Compare viable approaches when that comparison can change the implementation. Balance runtime, accessibility, and reliability.

Put material findings in a section titled "Runtime report".

# Cost considerations

Compare costs only when viable approaches differ materially in cost.

Put material findings in a section titled "Cost report".

# Proxy considerations

Use the default proxy configuration unless evidence shows another available configuration is necessary.

# Specifics and evidence

Include specifics in your report, including:
- Sample URLs
- Sample HTML snippets from those URLs
- Relevant selectors for all fields in output schema.
- Any other specifics that will be helpful for the coding agent

Give enough HTML snippets to write the proper selectors.

# Snippets

If tools are available, test your assumptions using snippets. You may include small code snippets that worked in the report output as appropriate.

# Output schema

Define an output schema for this function.

If the user input includes an output schema, it is authoritative. Do not add fields, wrappers, or metadata that are not present in the supplied schema.

Guidelines for output schema:
- Follow the user prompt
- Beyond that, give a nicely structured output with the key data
- Make it resilient. Unless absolutely necessary, make outputs optional.
- Do not overcomplicate the schema or add excessive nesting.
- If a specific output schema is provided in the user prompt section, use it exactly. Restate the user schema in your output.

# Additional guidelines

- The eventual script will be run in a node.js VM context, with specific modules made available, along with the tools you have
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

<output-schema>
{{outputSchema}}
</output-schema>

<== End User Input Section ==>

`
);

export const code = new Template(
  [
    'toolsForCode',
    'availableModules',
    'availableContext',
    'userInput',
    'outputSchema',
    'generalReport',
    'groupingName',
    'groupingReport',
  ],
  `You are writing a JavaScript web-scraping script. Use the reports below to write code.

If necessary, use tools to load pages and inspect the site further before generating the script.

The output schema below describes one extracted item. It is authoritative; export it exactly. The runtime owns and validates the run-result envelope, so do not add that envelope to outputSchema.

<output-schema>
{{outputSchema}}
</output-schema>

# Structure

Your code must be structured in the following way:

  export const outputSchema = { /* ... JSON schema ...*/ };
  export const uniqueId = (item) => { /* ... return a canonical string ... */ };
  export const check = async (urls) => { /* ... returns one boolean per URL ... */ };
  export const run = async (urls) => {
    return { results: [], urlsVisited: [] };
  };

# Function descriptions  

## uniqueId(result)

Export a synchronous uniqueId(result) function that returns a stable, non-empty, 12-character digest for every result. Select and normalize the strongest durable identifier components for the kind of item: an email address for a person, a product ID or canonical product URL for commerce, and similarly stable IDs for other domains. For example, trim and lowercase email addresses or normalize absolute URLs. Hash those normalized components with a deterministic synchronous hash implemented in the generated code, then return its 12-character digest. Do not use mutable labels, timestamps, random values, array positions, or unavailable crypto APIs. If no domain identifier exists, prefer a normalized URL or email address.

## check(urls)

Export an async check(urls) function. It receives a list of URLs and returns one boolean for each input URL, in the same order. True means that run(urls) can handle the URL; false means it cannot. Check URL patterns and, when useful, page structure using lightweight, specific inspection.

## run(urls)

This extracts data from the specified URLs. The data service has already validated and routed these URLs, so do not call check() again or silently ignore them. Return this envelope:

- "results": an array of objects matching outputSchema.
- "urlsVisited": an array of URLs visited while handling this call.

# Tools

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

# Reports

The general report applies to every script. The grouping report applies only to this script and takes precedence when it is more specific.

<general-report>
{{generalReport}}
</general-report>

<group-report grouping-name="{{groupingName}}">
{{groupingReport}}
</group-report>

# Comments

Begin your code with comments summarizing report findings briefly, including relevant format considerations, selectors, rate limits, provider, cost and runtime recommendations, as well as any other considerations.

# Debug output

Send debug output via console.log() as you go along. Log items as they are parsed, URLs you visit, and key points in the scraping.

# Additional guidelines

- Because you have availableModules, do not write any "import" lines.
- Do not attempt to spoof User Agents, etc. That will be handled elsewhere.
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
