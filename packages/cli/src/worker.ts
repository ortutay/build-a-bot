import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApiServer } from '@build-a-bot/api';
import { BuildABot } from '@build-a-bot/core';

const [entryPath, portValue] = process.argv.slice(2);

if (!entryPath) {
  throw new Error('Build-A-Bot worker requires an entry path.');
}

const port = portValue === undefined || portValue === '' ? undefined : Number(portValue);

if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
  throw new Error(`Invalid API port: ${portValue}`);
}

const entryUrl = pathToFileURL(path.resolve(entryPath)).href;
const entry = await import(entryUrl);
const buildABot = entry.buildABot;

if (!(buildABot instanceof BuildABot)) {
  throw new Error(`Expected ${entryPath} to export \"buildABot\" as an instance of BuildABot.`);
}

const server = await startApiServer(buildABot, { port });
process.send?.({ type: 'ready', port: server.port });
console.log(`Build-A-Bot API: http://localhost:${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void server.close());
}
