import { Agent } from './agent.js';
import { access } from './prompts.js';
import { general } from './tools.js';

export const defaultModel = 'google/gemini-3-flash-preview';

export const runAccess = async ({ url, prompt, model = defaultModel } = {}) => {
  if (!url || !prompt) throw new Error('url and prompt are required.');

  const agent = new Agent(model, general);
  try {
    agent.push({ role: 'user', content: access({ agent, url, prompt }) });

    for (let index = 0; index < 20; index++) {
      const reply = await agent.step();
      if (reply.stop) break;

      agent.push({
        role: 'user',
        content: `The browser state is now:\n== START browser state ==\n${JSON.stringify(agent.state())}\n== END browser state ==`,
      });
    }

    return { plan: agent.lastReply()?.content || '', usage: agent.usage };
  } finally {
    await agent.closeBrowser();
  }
};
