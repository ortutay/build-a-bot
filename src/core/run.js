import { Agent } from './agent.js';
import * as prompts from './prompts.js';
import { general } from './tools.js';

export const defaultModel = 'google/gemini-3-flash-preview';
const model = defaultModel;

export const runAccess = async ({ url, prompt }) => {
  const agent = new Agent(model, general);
  return agent.run(prompts.access({ agent, url, prompt }));
};

export const runPlan = async ({ url, prompt }) => {
  const agent = new Agent(model, general);
  return agent.run(prompts.plan({ agent, url, prompt }));
};

export const runCode = async ({ url, prompt, reports }) => {
  const agent = new Agent(model, general);
  return agent.run(prompts.code({ agent, url, prompt, reports }));
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
