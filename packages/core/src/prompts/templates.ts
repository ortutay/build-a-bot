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
  ['userInput', 'itemSchema'],
  `You are planning JavaScript web-scraping scripts for one data service. Explore and gather the information needed to write those scripts.

Do not write code yet. Produce a written implementation report for the coding agent and an item schema. If a schema was supplied, return itemSchema: null in every grouping; core injects the exact supplied schema. Do not repeat its JSON in reports. If no schema was supplied, generate it from the user goal and your research and return it as a JSON string without Markdown fences.

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

The service may own multiple scripts for different page types. At runtime, scripts use check(url) to return a boolean for each source URL before they run.

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

The generated script's check(url) function returns a boolean indicating whether it can handle that URL. It should use URL structure and, when useful, lightweight page inspection. In your report, provide specific routing guidance and evidence for this check.

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
- Relevant selectors for all fields in item schema.
- Any other specifics that will be helpful for the coding agent

Give enough HTML snippets to write the proper selectors.

# Snippets

If tools are available, test your assumptions using snippets. You may include small code snippets that worked in the report output as appropriate.

# Item schema

Define an item schema for this function.

If the user input includes an item schema, it is authoritative. Do not add fields, wrappers, or metadata that are not present in the supplied schema.

Guidelines for item schema:
- Follow the user prompt
- Beyond that, give a nicely structured item with the key data
- Make it resilient. Unless absolutely necessary, make outputs optional.
- Do not overcomplicate the schema or add excessive nesting.
- If a specific item schema is provided, design extraction for it exactly, but return itemSchema: null; core preserves the original object.

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

<item-schema>
{{itemSchema}}
</item-schema>

<== End User Input Section ==>

`
);

export const code = new Template(
  [
    'toolsForCode',
    'availableModules',
    'availableContext',
    'userInput',
    'itemSchema',
    'generalReport',
    'groupingName',
    'groupingUrls',
    'groupingReport',
  ],
  `You are writing a JavaScript web-scraping script. Use the reports below to write code.

Research is complete. Return JavaScript now without calling tools during this response. Tool functions described below are for the emitted script to call at runtime; they are not instructions to continue browsing while writing code.

The item schema below describes one extracted item. It is authoritative; export it exactly, and follow it exactly.

<item-schema>
{{itemSchema}}
</item-schema>

Each extracted item must match this item schema. run(url) returns an array of these items directly, without a results wrapper.

# Targeting the specific grouping

You are targetting a specific named grouping of pages with the name "{{groupingName}}". This grouping represents pages that were determined to have similar structure, and can be parsed together. The scraper you will write should handle these types of pages.

These are some example URLs for this grouping. These are merely representative examples, and may not be an exhaustive list of URLs that your scraper should handle.

<grouping-urls>
{{groupingUrls}}
</grouping-urls>

# Structure

Your code must be structured in the following way:

  export const itemSchema = { /* ... JSON schema ...*/ };
  export const uniqueId = (item) => { /* ... return a canonical string ... */ };
  export const check = async (url) => { /* ... returns boolean ... */ };
  export const run = async (url) => { /* ... returns an array of items ... */ };

Both functions receive one URL string. They may be called concurrently for different URLs. Generate executable JavaScript, without TypeScript annotations. Let exceptions propagate to the caller; DataService handles errors independently for each URL.

# Function descriptions  

## uniqueId(result)

Export a synchronous uniqueId(result) function that returns a stable, non-empty, 12-character digest for every result. Select and normalize the strongest durable identifier components for the kind of item: an email address for a person, a product ID or canonical product URL for commerce, and similarly stable IDs for other domains. For example, trim and lowercase email addresses or normalize absolute URLs. Hash those normalized components with a deterministic synchronous hash implemented in the generated code, then return its 12-character digest. Do not use mutable labels, timestamps, random values, array positions, or unavailable crypto APIs. If no domain identifier exists, prefer a normalized URL or email address.

## check(url)

Export an async check(url) function returning a boolean: true if run(url) can handle this URL, false otherwise. Use URL patterns and, when useful, lightweight page inspection. Throw on inspection failures; do not return error objects.

## run(url)

Export an async run(url) function returning an array of items matching itemSchema. The URL has already been routed; do not call check() again.

- Return items directly: [item1, item2]. For a detail page with one item, return [item]. Do not wrap them in result/results objects or URL envelopes.
- Return [] only when extraction succeeds with zero items. Do not return null or undefined, and never treat blocked, timed-out or incomplete extraction as an empty source.
- Let extraction failures throw. Buffer items until extraction completes so failures do not return partial data.
- Calls for independent URLs may run concurrently. Use pq to limit acquisition, keep browser cursors and temporary state local to the call, and clean up resources in finally blocks.

# Tools

The process that loads your code expects this format, with these exact names.

{{toolsForCode}}

# Available nodejs modules

You have access to these modules, which are in the VM context. Do not import them, simply use them if needed.

{{availableModules}}

# Available context

You have access to these globals in the VM context

{{availableContext}}

# Concurrency object

You have in your context a special object: \`pq\`. It is an instance of new PQueue() from https://github.com/sindresorhus/p-queue. It was instantiated like this:

  const pq = new PQueue({ concurrency: ...value... });

You should use this for limiting concurrency for fetch, browser instances, etc. The exact concurrency value has already been set, in accordance with proper rules like robots.txt. Therefore, you can simple make fetch tool calls, browser tool calls, etc. like this:

  const results = await Promise.all(
    urls.map(url => pq.add(() => tools.fetchTool({ url, proxy: '...' }))
  );

Again, you do not need to create the pq object. It is already in the context.

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
- Do not parse more than 10,000 pages or generate more than 10,000 items. Enforce this by stopping early and/or processing only a deterministic subset of the input.
- ${guidelineDoNotInvent}
- ${guidelinePlaywrightStrictMode}
- ${guidelineTestSnippets}

{{userInput}}
`
);
