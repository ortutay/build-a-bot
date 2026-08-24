// @ts-nocheck TS2589: ignore due ot zod/TypeScript server mismatch

import * as z from 'zod';
import { describe, it, expect } from 'vitest';
import { build } from '../src/index.js';
import { Workshop } from '../src/workshop/Workshop.js';
import { browserPlanStep } from '../src/workshop/steps.js';
import { defaultMastra } from '../src/mastra/index.js';
import { pokemonTarget } from './targets.js';

describe('full evals', () => {
  it('should build and scrape pokemon', async () => {
    const ws = new Workshop();
    const bot = await ws.build(pokemonTarget);
    const out = await bot.run(pokemonTarget.exampleInput);
    console.log('Out:', out);
  }, 180_000);
});
