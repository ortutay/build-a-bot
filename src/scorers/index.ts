import { createScorer } from '@mastra/core/evals';
import { z } from 'zod';
import { toBot } from '../compile/Compiler.js';
import { mastra } from '../mastra/index.js';
import { srid } from '../util/index.js';

export const planStepScorer = createScorer({
  id: 'plan-step-scorer',
  description: 'Check if scraping plan appears correct.',
  judge: {
    model: 'openai/gpt-5.6-terra',
    instructions: 'You are a strict evaluator.',
  },
})
  .analyze({
    description: 'Determine if the scraping plan appears correct.',
    outputSchema: z.object({
      analysis: z.string(),
      score: z.number().min(0).max(1),
    }),
    createPrompt: ({ run }) => `Evaluate whether this scraping plan appears correct.

Return a score from 0 to 1, where 1 means the plan is correct and complete for
the requested task, and 0 means it is unusable or unrelated. Use intermediate
values for partial correctness.

Keep your analysis concise.

<plan>
${JSON.stringify(run.output, null, 2)}
</plan>
`,
  })
  .generateScore(({ results }) => results.analyzeStepResult.score);

export const buildScorer = createScorer({
  id: 'build-scorer',
  description: 'Check if the output code and results appear correct.',
  judge: {
    model: 'openai/gpt-5.6-terra',
    instructions: 'You are a strict evaluator.',
  },
})
  .preprocess(async (args) => {
    const { run } = args;
    console.log('build scorer on:', run);
    const code = run.output.code;
    const bot = await toBot(code, mastra.getAgentById('build-agent'));
    console.log('built bot, toBot:', bot);
    const exampleInput = run.input.exampleInput ?? bot.exampleInput;
    const runId = srid();
    const results = await bot.run(exampleInput, runId);
    const logs = bot.getLogs(runId);
    console.log('bot logs:', logs);
    console.log('bot results:', results);
    return {
      code,
      exampleInput,
      results,
      logs,
    };
  })
  .analyze({
    description: 'Determine if the output code and results appear correct.',
    outputSchema: z.object({
      analysis: z.string(),
      score: z.number().min(0).max(1),
    }),
    createPrompt: ({
      run,
    }) => `Evaluate whether scraper appears correct. Focus on output correctness, and also consider code robustness and likely reliability as secondary scoring factors.

Return a score from 0 to 1, where 1 means the code and output are correct and complete for the requested task, and 0 means it is unusable or unrelated. Use intermediate values for partial correctness.

Keep your analysis concise.

<plan>
${JSON.stringify(run.output, null, 2)}
</plan>
`,
  })
  .generateScore(({ results }) => results.analyzeStepResult.score);
