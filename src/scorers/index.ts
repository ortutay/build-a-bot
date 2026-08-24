import { createScorer } from '@mastra/core/evals';
import { z } from 'zod';

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
