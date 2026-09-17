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
  ['userInput', 'itemSchema', 'capabilities'],
  `You are planning JavaScript web-scraping scripts for one data service. Explore and gather the information needed to write those scripts.

Do not write code yet. Return one shared report. The supplied item schema is authoritative: do not return, alter, or repeat it. Each grouping contains only groupingName, groupingDescription, and urls.

Copy the user goal into the top-level goal field. Copy these capability lists into the top-level modules, context, and tools fields without changing them:

<capabilities>
{{capabilities}}
</capabilities>

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

Within the shared report, include a general section and sections with findings specific to each named grouping.

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

The supplied item schema is authoritative. Research the page structure needed to extract it exactly; do not add fields, wrappers, or metadata.

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

const codeStructureSection = `# Code structure

Bot code must be structured in the following way:

  export const itemSchema = { /* ... JSON schema ...*/ };
  export const uniqueId = (item) => { /* ... return a canonical string ... */ };
  export const check = async (url) => { /* ... returns boolean ... */ };
  export const run = async (url) => { /* ... returns an array of items ... */ };

The process that loads the bot code expects this format, with these exact names.

Both functions check and run receive one URL string. They may be called concurrently for different URLs. Generate executable JavaScript, without TypeScript annotations. Let exceptions propagate to the caller; DataService handles errors independently for each URL.

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
`;

const codeGuidelinesSection = `# Tools

You have access to the following tools.

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

# Concurrency object

You have in your context a special object: \`pq\`. It is an instance of new PQueue() from https://github.com/sindresorhus/p-queue. It was instantiated like this:

  const pq = new PQueue({ concurrency: ...value... });

You should use this for limiting concurrency for fetch, browser instances, etc. The exact concurrency value has already been set, in accordance with proper rules like robots.txt. Therefore, you can simple make fetch tool calls, browser tool calls, etc. like this:

  const results = await Promise.all(
    urls.map(url => pq.add(() => tools.fetchTool({ url, proxy: '...' }))
  );

Generally, URLs should be handled concurrently.

Again, you do not need to create the pq object. It is already in the context.

# Comments

Begin your code with context, explanation and a description. This comment section should contain enough information for a future LLM or human to read the script, understand the intent, and make fixes. Include information about pages that are or are not in scope, including relevant format considerations, selectors, and so on.

# Debug logging

Send debug output via console.log() as you go along. Log items as they are parsed, URLs you visit, and key points in the scraping. You should make use of console.log(...) to log debug output. This will be useful both for the user experience, and also for you, if and when you need to debug the script. Log major events, browser actions, page navigation, parsed items, and anything else that is significant, or liable to fail, or take seconds to complete.

# Comments

# Additional guidelines

- Because you have availableModules, do not write any "import" lines.
- Do not attempt to spoof User Agents, etc. That will be handled elsewhere.
- Write structured code, and avoid hard coding specific data or content.
- The fetch tools already handle robots.txt rules. You can call them at any rate limit, and robots.txt handling is applied upstream
- Do not parse more than 10,000 pages or generate more than 10,000 items. Enforce this by stopping early and/or processing only a deterministic subset of the input.
- Generally, prefer to return items with errors in fields over crashing out entirely
- ${guidelineDoNotInvent}
- ${guidelinePlaywrightStrictMode}
- ${guidelineTestSnippets}
`;

export const code = new Template(
  [
    'toolsForCode',
    'availableModules',
    'availableContext',
    'userInput',
    'itemSchema',
    'report',
    'groupingDescription',
    'groupingName',
    'groupingUrls',
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

<grouping-description>
{{groupingDescription}}
</grouping-description>

These are some example URLs for this grouping. These are merely representative examples, and may not be an exhaustive list of URLs that your scraper should handle.

<grouping-urls>
{{groupingUrls}}
</grouping-urls>

${codeStructureSection}

${codeGuidelinesSection}

# Reports

The shared report covers all groupings. Apply its general findings and the findings specific to the named grouping above.

<report>
{{report}}
</report>

{{userInput}}
`
);

export const heal = new Template(
  [
    'userInput',
    'toolsForCode',
    'itemSchema',
    'availableModules',
    'availableContext',
    'errors',
    'code',
  ],
  `You are evaluating and possibly fixing a Javascript scraping script.

${codeStructureSection}

${codeGuidelinesSection}

# Original user input

{{userInput}}

The item schema is:

{{itemSchema}}

# Existing code

The code for the script you are evaluating is below. This script is loaded into the bot tool.

<existing-code>
{{code}}
</existing-code>

If there was an errors for this code, they will be below:

<errors>
{{errors}}
</errors>

# Keep intent

If you make fixes, be sure to keep the original intent of the code, and be careful not to broaden the script beyond what it was meant to handle.

That said, do not be restricted by the previous code you see. You an throw it all out, especially if it is structurally flawed, overly complex, or hard to salvage.
`
);
