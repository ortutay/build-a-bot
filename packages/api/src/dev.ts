import { BuildABot } from '@build-a-bot/core';
import { BuildABotAPI } from './BuildABotAPI.js';

const api = new BuildABotAPI({ buildABot: new BuildABot() });
const server = await api.start();

console.log(`Build-A-Bot API listening on http://localhost:${server.port}`);
