# Build-A-Bot

This repository is an npm workspace containing four packages:

- `@build-a-bot/core` — the standalone Build-A-Bot runtime. Its only public export is the current `BuildABot` stub.
- `@build-a-bot/api` — an HTTP API backed by one `BuildABot` instance.
- `@build-a-bot/studio` — the React Studio UI, which reaches the API over HTTP.
- `build-a-bot` — the CLI that loads a client project's Build-A-Bot instance and starts its API and Studio.

## Development

```bash
npm install
npm run dev
```

`npm run dev` runs Core's compiler watcher, the API at `http://localhost:3000`, and Studio at Vite's default `http://localhost:5173`.

Run each target directly with `npm run dev:core`, `npm run dev:api`, or `npm run dev:studio`. Studio proxies `/api` to the local API while developing. Set `VITE_API_BASE_URL` when Studio should use a separately deployed API.

## Client projects

From a client project root, `npx build-a-bot init` creates `build-a-bot-project.json`,
`src/build-a-bot/index.ts`, and `.env.example`. `npx build-a-bot dev` reads only the
current directory's config file and loads its `entry` path. Without an `entry`, it tries
`src/build-a-bot/index.ts` and then `src/build-a-bot/index.js`; it does not search for
other project files.
