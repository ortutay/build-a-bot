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

Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to a hosted Turso/LibSQL database in `.env`; Mastra storage does not support a build-host-local SQLite file. Local runs also use `REDIS_CACHE_URL` (normally `redis://localhost:54321`). For Mastra Platform deployments, attach a database in **Project Settings → Databases** so the platform supplies the Turso variables.

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
