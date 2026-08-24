// @ts-nocheck TS2589: ignore due ot zod/TypeScript server mismatch

import * as z from 'zod';
import { createWorkflow } from '@mastra/core/workflows';
import { describe, it, expect } from 'vitest';
import { build } from '../src/index.js';
import { Workshop } from '../src/workshop/Workshop.js';
import { browserPlanStep } from '../src/workshop/steps.js';
import { defaultMastra } from '../src/mastra/index.js';
import { c21Target, pokemonTarget } from './targets.js';

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

      console.log('Report:', out.result.report);
    } finally {
      await cleanup();
    }
  }, 180_000);

  it('should plan c21 for browser', async () => {
    const { mastra, cleanup } = await defaultMastra();
    try {
      console.log('browser c21 plan');
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
          url: c21Target.url,
          goal: c21Target.prompt,
        },
      });

      console.log('Report:', out.result.report);
    } finally {
      await cleanup();
    }
  }, 180_000);
});
