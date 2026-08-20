// @ts-nocheck TS2589: ignore due ot zod/TypeScript server mismatch

import * as z from 'zod';
import { type BuildOptions } from '../src/types.js';

export const pokemonTarget: BuildOptions = {
  url: 'https://pokemondb.net/pokedex/national',
  prompt:
    'scrape pokemon: name, number, basic stats including HP, and a list of move names. input is pokemon names, either single string or a list of names',
  inputSchema: z.object({
    names: z.array(z.string()).describe('list of pokemon to scrape'),
  }),
};

const realEstateInputSchema = z.object({
  limit: z.number().describe('max number of results to return per page').optional().default(1000),
  page: z.number().describe('page number').optional().default(1),
});

const realEstateOutputSchema = z.object({
  name: z.string('agent name'),
  email: z.string('agent email'),
  phone: z.string('agent phone'),
  url: z.string('agent profile URL'),
  agencyName: z.string('name of the agency for this agent'),
  address: z.string('agent address (as specific as possible)'),
});

const realEstatePrompt = 'extract each agent name and email address';

export const c21Target: BuildOptions = {
  url: 'https://realestatecenter.sites.c21.homes/agents-offices',
  prompt: realEstatePrompt,
  inputSchema: realEstateInputSchema,
  outputSchema: realEstateOutputSchema,
};
