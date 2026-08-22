# builder

An experimental web-access agent built around direct OpenRouter tool calls and plain Playwright.

The project is a library-style runner for now. It intentionally has no CLI, MCP server, proxy tiers, CAPTCHA solver, browser stealth layer, or agent-orchestration framework.

## Setup

```bash
npm install
npm test
npm run lint
```

Set `OPENROUTER_API_KEY` before calling `build()`.

## Deploying with Mastra

Local runs use `REDIS_CACHE_URL` (normally `redis://localhost:54321`) and a file-backed LibSQL database. Mastra Platform deployments are detected through `MASTRA_PLATFORM_ACCESS_TOKEN`; there, the runtime uses an in-memory cache and requires a hosted Turso/LibSQL database. Attach one in **Project Settings → Databases** so the platform supplies `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

Configure the provider keys for every remote tool you enable, especially `OPENROUTER_API_KEY`, `BRIGHTDATA_API_KEY`, and `SCRAPINGBEE_API_KEY`.

For manual experimentation, edit `src/scratch.js` and run:

```bash
npm run scratch
```

```js
import { build } from '@fetchfox/builder';

const { fn, code, inputSchema, outputSchema, usage } = await build({
  url: 'https://example.com',
  prompt: 'Describe the content available on this page.',
});

const result = await fn({});
```

## Browser behavior

`launchBrowser()` starts a standard headless Playwright Chromium instance. No FetchFox stealth, CAPTCHA, storage, or worker code is included.

## Proxies

Copy `.env.example` to `.env` and configure only the proxy tiers you intend to use. The available tool values are `none`, `datacenter`, `residential`, `residentialCdp`, and `unblock`.
