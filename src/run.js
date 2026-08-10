import { Agent } from './agent.js';
import * as prompts from './prompts.js';
import { general } from './tools.js';

export const defaultModel = 'google/gemini-3-flash-preview';
const model = defaultModel;

const run = async ({ agent, content } = {}) => {
  try {
    agent.push({ role: 'user', content });

    for (let index = 0; index < 20; index++) {
      const reply = await agent.step();
      if (reply.stop) break;

      agent.push({
        role: 'user',
        content: `The browser state is now:\n== START browser state ==\n${JSON.stringify(agent.state())}\n== END browser state ==`,
      });
    }

    return { content: agent.lastReply()?.content || '', usage: agent.usage };
  } finally {
    await agent.closeBrowser();
  }
};

export const runAccess = async ({ url, prompt }) => {
  const agent = new Agent(model, general);
  return run({
    content: prompts.access({ agent, url, prompt }),
    agent,
  });
};

export const runPlan = async ({ url, prompt }) => {
  const agent = new Agent(model, general);
  return run({
    content: prompts.plan({ agent, url, prompt }),
    agent,
  });
};

export const runCode = async ({ url, prompt, reports }) => {
  const agent = new Agent(model, general);
  return run({
    content: prompts.code({ agent, url, prompt, reports }),
    agent,
  });
};

export const runFull = async ({ url, prompt }) => {
  const [accessReport, planReport] = await Promise.all([
    runAccess({ url, prompt }),
    runPlan({ url, prompt }),
  ]);

  console.log({
    accessReport,
    planReport,
  });

  const reports = [
    ['access-report', accessReport],
    ['general-plan', planReport],
  ]
    .map(([title, out]) => `<${title}>\n${out.content}\n</${title}>`)
    .join('\n\n');

  console.log('Reports:', reports);
  const code = await runCode({ url, prompt, reports });
  return code;
};
