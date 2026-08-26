import { BuildABot } from '@build-a-bot/core';
import { startApiServer } from './server.js';

const server = await startApiServer(new BuildABot());

console.log(`Build-A-Bot API listening on http://localhost:${server.port}`);
