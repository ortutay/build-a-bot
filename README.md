# builder

An experimental, local web-access agent built around direct OpenRouter tool calls and plain Playwright.

The project is a library-style runner for now. It intentionally has no CLI, MCP server, proxy tiers, CAPTCHA solver, browser stealth layer, or agent-orchestration framework.

## Setup

```bash
npm install
npm test
npm run lint
```

Set `OPENROUTER_API_KEY` before calling `runAccess()` from `src/run.js`.

```js
import { runAccess } from './src/run.js';

const result = await runAccess({
  url: 'https://example.com',
  prompt: 'Describe the content available on this page.',
});
```

## Browser behavior

`launchBrowser()` starts a standard headless Playwright Chromium instance. No FetchFox stealth, proxy, CAPTCHA, storage, or worker code is included.
