// @ts-nocheck TS2589: ignore due ot zod/TypeScript server mismatch

import * as z from 'zod';
import { describe, it, expect } from 'vitest';
import { runEvals } from '@mastra/core/evals';
import { build } from '../src/index.js';
import { Workshop, writeWorkflow } from '../src/workshop/Workshop.js';
import { mastra, cleanup } from '../src/mastra/index.js';
import { buildScorer } from '../src/scorers/index.js';
import { pokemonTarget } from './targets.js';

describe('full evals', () => {
  it('should build and scrape pokemon', async () => {
    try {
      const workflow = writeWorkflow;
      const result = await runEvals({
        target: workflow,
        data: [
          {
            input: {
              url: pokemonTarget.url,
              goal: pokemonTarget.prompt,
              inputSchema: pokemonTarget.inputSchema,
            },
          },
        ],
        scorers: {
          workflow: [buildScorer],
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
    } finally {
      await cleanup();
    }

    // const bot = await ws.build(pokemonTarget);
    // const out = await bot.run(pokemonTarget.exampleInput);
    // console.log('Out:', out);
  }, 180_000);
});
