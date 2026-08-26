import { createScorer } from '@mastra/core/evals';
import { z } from 'zod';
import { toBot } from '../../compile/toBot.js';
import { srid } from '../../util/index.js';

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
    const code = run.output.code;
    const bot = await toBot(code);
    const exampleInput = run.input?.exampleInput ?? bot.exampleInput;
    const runId = srid();
    const results = await bot.run(exampleInput, runId);
    const logs = bot.getLogs(runId);
    return {
      code,
      exampleInput,
      results,
      logs,
    };
  })
  .generateScore({
    description: 'Determine if the output code and results appear correct.',
    // @ts-expect-error TS2353 — bug in mastra 1.61.0
    outputSchema: z.object({
      analysis: z.string(),
      score: z.number().min(0).max(1),
    }),
    createPrompt: ({
      run,
      results,
    }) => `Evaluate whether the generated scraper succeeded in giving correct results.

Bot blocks, compilation/runtime failures, invalid output, or failure to get the right data should receive a low score.

Evaluate the results mostly from the perspective of the user, who wants correct, reliable data. However, also consider the code, and possible failure cases that don't show up in this specific run.

You don't have the ground truth, use your general world knowledge to evaluate if the results seem reasonable and correct. Do not mark down results if you lack full knowledge to validate them, in those cases use your common sense as ground truth.

Keep the analysis concise.

<task>
${JSON.stringify(run.input, null, 2)}
</task>

<generated-code>
${results.preprocessStepResult.code}
</generated-code>

<execution>
${JSON.stringify(results.preprocessStepResult, null, 2)}
    </execution>
`,
    calculateScore: (output: { score: number }) => output.score,
  })
  .generateReason({
    description: 'Explain the scraper evaluation score.',
    createPrompt: ({
      results,
      score,
    }) => `Explain this scraper evaluation score in one concise paragraph.

<score>
${score}
</score>

<execution>
${JSON.stringify(results.preprocessStepResult, null, 2)}
</execution>

Identify the most important evidence supporting the score, including any failures or reliability concerns. Keep your explanation high in signal, low in boilerplate and low in noise.
`,
  });
