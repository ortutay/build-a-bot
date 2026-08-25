// @ts-nocheck TS2589: ignore due ot zod/TypeScript server mismatch

import * as z from 'zod';
import { describe, it, expect, afterAll } from 'vitest';
import { runEvals } from '@mastra/core/evals';
import { build } from '../src/index.js';
import { Workshop, writeWorkflow } from '../src/workshop/Workshop.js';
import { mastra, cleanup } from '../src/mastra/index.js';
import { buildScorer } from '../src/scorers/index.js';
import {
  pokemonTarget,
  c21Target,
  northeastTarget,
  yelmofficeTarget,
  realEstateTargets,
  realEstateTopLevelTargets,
} from './targets.js';

describe('full evals', () => {
  const runTarget = async (target) => {
    const workflow = writeWorkflow;
    const result = await runEvals({
      target: workflow,
      data: [
        {
          input: {
            url: target.url,
            goal: target.prompt,
            inputSchema: target.inputSchema,
            exampleInput: target.exampleInput,
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
  };

  afterAll(async () => {
    await cleanup();
  });

  it('should build and scrape pokemon', async () => {
    await runTarget(pokemonTarget);
  }, 180_000);

  it('should build and scrape northeast', async () => {
    await runTarget(northeastTarget);
  }, 180_000);

  it('should build and scrape yelmoffice', async () => {
    await runTarget(yelmofficeTarget);
  }, 180_000);

  for (const target of realEstateTargets) {
    it(`should build and scrape ${target.url} @real-estate`, async () => {
      await runTarget(target);
    }, 180_000);
  }

  for (const target of realEstateTopLevelTargets) {
    it(`should build and scrape ${target.url} @top-level-real-estate`, async () => {
      await runTarget(target);
    }, 180_000);
  }
});
