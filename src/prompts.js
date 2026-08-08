const setup = ({ agent, url, prompt }) => `Here is the user input:
== START user input ==
URL: ${url}
Prompt: ${prompt}
== END user input ==

Here is the current browser state:
== START browser state ==
${JSON.stringify(agent.state())}
== END browser state ==`;

export const access = ({
  agent,
  url,
  prompt,
}) => `You are part of a team of agents building a web scraper using JavaScript. Your specific task is to determine the best way to access a website for a user request. Optimize for cost, speed, and coverage of the data relevant to the user.

# Rendering options

- nodeFetch(): cheapest and fastest, but it runs one HTTP GET and does not render JavaScript.
- jsFetch(): executes page JavaScript with happy-dom. It is heavier than fetch but lighter than a full browser.
- Full Playwright using launchBrowser(), goto(), and related tools: the heaviest option, but most similar to a real user browser.

# Proxy options

- "none": direct connection.
- "datacenter": configured datacenter proxy.
- "residential": configured residential proxy.
- "residentialCdp": configured residential browser connection. Use only with launchBrowser().
- "unblock": configured unblocking fetch API. Use only with nodeFetch() or jsFetch().

Use the least expensive option that successfully accesses the required data.

# Empirical approach

Use tools to compare rendering options. Do not guess; base the report on observed results.

# Output format

Write a plain-English report for a coordinating agent, explaining the recommended rendering approach and the evidence supporting it. If nothing works, then say that.

${setup({ agent, url, prompt })}`;

export const plan = ({
  agent,
  url,
  prompt,
}) => `You are writing a JavaScript web scraping script. Explore and gather information until you can write the script.

Guidelines:
- When code will operate on multiple pages, inspect at least two examples to confirm reusable selectors.
- If the task is impossible, explain why and stop.

${setup({ agent, url, prompt })}`;
