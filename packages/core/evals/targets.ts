// @ts-nocheck TS2589: ignore due ot zod/TypeScript server mismatch

import * as z from 'zod';
import { type BuildOptions } from '../src/internal/types.js';

export const pokemonTarget: BuildOptions = {
  url: 'https://pokemondb.net/pokedex/national',
  prompt:
    'scrape pokemon: name, number, basic stats including HP, and a list of move names. input is pokemon names, either single string or a list of names',
  inputSchema: z.object({
    names: z.array(z.string()).describe('list of pokemon to scrape'),
  }),
  exampleInput: {
    names: ['pikachu', 'squirtle'],
  },
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

export const northeastTarget: BuildOptions = {
  url: 'https://northeastalrealtor.com/realtor',
  prompt: realEstatePrompt,
  inputSchema: realEstateInputSchema,
  outputSchema: realEstateOutputSchema,
};

export const yelmofficeTarget: BuildOptions = {
  url: 'https://yelmoffice.johnlscott.com/find-agent',
  prompt: realEstatePrompt,
  inputSchema: realEstateInputSchema,
  outputSchema: realEstateOutputSchema,
};

const realEstateUrls = [
  'https://northeastalrealtor.com/realtor',
  'https://yelmoffice.johnlscott.com/find-agent',
  'https://westseattleoffice.johnlscott.com/find-agent',
  'https://realestatecenter.sites.c21.homes/agents-offices',
  'https://www.nostalgichomes.com/agents.php',
  'https://www.sothebysrealty.com/eng/associates/int/180-b-82391-4001320-brokerid',
  'https://theagencyseattle.com/our-brokers',
  'https://orca.myrealtyonegroup.com/real-estate-agents/dsort-fa/1',
  'https://www.bhhscalifornia.com/real-estate-office/montecito-midtown/259',
];

const realEstateTargets_ = [];
const realEstateTopLevelTargets_ = [];

for (const url of realEstateUrls) {
  const u = new URL(url);
  realEstateTargets_.push({
    url,
    prompt: realEstatePrompt,
    inputSchema: realEstateInputSchema,
    outputSchema: realEstateOutputSchema,
  });
  realEstateTopLevelTargets_.push({
    url: u.origin,
    prompt: realEstatePrompt,
    inputSchema: realEstateInputSchema,
    outputSchema: realEstateOutputSchema,
  });
}

export const realEstateTargets = realEstateTargets_;
export const realEstateTopLevelTargets = realEstateTopLevelTargets_;
