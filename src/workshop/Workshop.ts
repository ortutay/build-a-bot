import { Mastra } from '@mastra/core';
import { log } from '../logger.js';
import { type AgentOptions, Agent } from '../agent/Agent.js';
import { Bot } from '../bot/Bot.js';
import * as prompts from './prompts.js';

import { defaultMastra } from '../mastra.js';

export type BuildOptions = {
  url: string;
  prompt: string;
  agentOptions: AgentOptions;
};

export class Workshop {
  constructor() {}

  async build(options: BuildOptions, mastra?: Mastra): Promise<Bot> {
    log.info(`Build a bot:\n\turl=${options.url}\n\tprompt=${options.prompt}`);

    if (mastra) {
      log.info('Got Mastra:', mastra);
    } else {
      mastra = await defaultMastra();
      log.info('Instantiated default Mastra:', mastra);
    }

    const bot = new Bot();
    return bot;
  }
}
