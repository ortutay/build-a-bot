import { log } from '../logger.js';
import { Bot } from '../bot/Bot.js';

export type BuildOptions = {
  url: string;
  prompt: string;
};

export class Workshop {
  constructor() {}

  async build(options: BuildOptions): Promise<Bot> {
    log.info('Build a bot based:', options);
    const bot = new Bot();
    return bot;
  }
}
