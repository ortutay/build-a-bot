import { log } from '../logger.js';
import { Agent } from '../agent/Agent.js';
import { Bot } from '../bot/Bot.js';

export type BuildOptions = {
  url: string;
  prompt: string;
};

export class Workshop {
  constructor(public agent: Agent) {}

  async build(options: BuildOptions): Promise<Bot> {
    log.info('Build a bot:', options);
    console.log('Building using agent:', this.agent);
    const bot = new Bot();
    return bot;
  }
}
