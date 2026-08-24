// @ts-nocheck TS2589: ignore due ot zod/TypeScript server mismatch

import * as z from 'zod';
import { createWorkflow } from '@mastra/core/workflows';
import { describe, it, expect } from 'vitest';
import { build } from '../src/index.js';
import { Workshop } from '../src/workshop/Workshop.js';
import { browserPlanStep } from '../src/workshop/steps.js';
import { defaultMastra } from '../src/mastra/index.js';
import { c21Target, pokemonTarget } from './targets.js';
import { planStepScorer } from '../src/scorers/index.js';

import { runEvals } from '@mastra/core/evals';

describe('browserPlanStep', () => {
  const runForTarget = async (target: any) => {
    const { mastra, cleanup } = await defaultMastra();
    try {
      const workflow = createWorkflow({
        mastra,
        id: 'browser-plan-workflow',
        inputSchema: browserPlanStep.inputSchema,
        outputSchema: browserPlanStep.outputSchema,
      })
        .then(browserPlanStep)
        .commit();

      const result = await runEvals({
        target: workflow,
        data: [
          {
            input: {
              url: target.url,
              goal: target.prompt,
            },
          },
        ],
        scorers: {
          workflow: [planStepScorer],
        },
        onItemComplete: ({ item, targetResult, scorerResults }) => {
          console.log(`Workflow completed for:`, item);
          if (scorerResults.workflow) {
            for (const key of Object.keys(scorerResults.workflow)) {
              console.log('Score:', key, scorerResults.workflow[key].score);
              console.log('Analysis:', key, scorerResults.workflow[key].analyzeStepResult);
            }
          }
        },
      });

      console.log('Workflow result:', result);
    } finally {
      await cleanup();
    }
  };

  it('should plan pokemon for browser', async () => {
    await runForTarget(pokemonTarget);
  }, 180_000);

  it('should plan c21 for browser', async () => {
    await runForTarget(c21Target);

    // const { mastra, cleanup } = await defaultMastra();
    // try {
    //   console.log('browser c21 plan');
    //   const workflow = createWorkflow({
    //     mastra,
    //     id: 'browser-plan-workflow',
    //     inputSchema: browserPlanStep.inputSchema,
    //     outputSchema: browserPlanStep.outputSchema,
    //   })
    //     .then(browserPlanStep)
    //     .commit();

    //   const run = await workflow.createRun();
    //   const out = await run.start({
    //     inputData: {
    //       url: c21Target.url,
    //       goal: c21Target.prompt,
    //     },
    //   });

    //   console.log('Report:', out.result.report);
    // } finally {
    //   await cleanup();
    // }
  }, 180_000);
});
