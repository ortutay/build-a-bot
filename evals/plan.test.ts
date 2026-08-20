// @ts-nocheck TS2589: ignore due ot zod/TypeScript server mismatch

import * as z from 'zod';
import { createWorkflow } from '@mastra/core/workflows';
import { describe, it, expect } from 'vitest';
import { build } from '../src/index.js';
import { Workshop } from '../src/workshop/Workshop.js';
import { browserPlanStep } from '../src/workshop/steps.js';
import { defaultMastra } from '../src/mastra.js';
import { pokemonTarget } from './targets.js';

describe('browserPlanStep', () => {
  it('should plan pokemon for browser', async () => {
    const { mastra, cleanup } = await defaultMastra();
    try {
      console.log('browser pokemon plan');
      const workflow = createWorkflow({
        mastra,
        id: 'browser-plan-workflow',
        inputSchema: browserPlanStep.inputSchema,
        outputSchema: browserPlanStep.outputSchema,
      })
        .then(browserPlanStep)
        .commit();

      const run = await workflow.createRun();
      const out = await run.start({
        inputData: {
          url: pokemonTarget.url,
          goal: pokemonTarget.prompt,
        },
      });
      console.log('Workflow run result:', out);
      console.log('Report:', out.result.report);

      // const out = await browserPlanStep.execute({
      //   inputData: { url: pokemonTarget.url, goal: pokemonTarget.prompt },
      //   mastra,
      // });
      // console.log('Step out:', out.report);
    } finally {
      await cleanup();
    }
  }, 180_000);
});
