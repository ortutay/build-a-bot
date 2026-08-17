// @ts-nocheck TS2589: ignore due ot zod/TypeScript server mismatch
import * as z from 'zod';
import { describe, it, expect } from 'vitest';
import { build } from '../../src/index.js';
import { Workshop } from '../../src/workshop/Workshop.js';

describe('Dogfood Builder Tests', () => {
  const pokemonTarget = {
    url: 'https://pokemondb.net/pokedex/national',
    prompt:
      'scrape pokemon: name, number, and basic stats including HP. input is pokemon names, either single string or a list of names',
    inputSchema: z.object({
      names: z.array(z.string()).describe('list of pokemon to scrape'),
    }),
  };

  it('should build a bot for pokemon', async () => {
    const ws = new Workshop();
    const bot = await ws.build(pokemonTarget);
    const out = await bot.run({
      names: ['pikachu', 'squirtle'],
    });
    console.log(out);
  }, 180_000);

  it('should plan for pokemon', async () => {
    const ws = new Workshop();
    const out = await ws.plan(pokemonTarget);
    console.log('Plan out:', out);
  }, 180_000);
});

describe('Escape Room Builder Tests', () => {
  it('should build a bot for omescape escape rooms', async () => {
    const ws = new Workshop();
    const plan = await ws.plan({
      url: 'https://www.edscapadegames.com/book-now',
      prompt: 'scrape a list of all escape rooms',
      inputSchema: {
        city: z.string().describe('Omescape city to scrape'),
      },
    });
    console.log('Plan out:', plan);
  }, 180_000);

  it('should build a bot for omescape availabilities', async () => {
    const ws = new Workshop();
    const plan = await ws.plan({
      url: 'https://www.edscapadegames.com/book-now',
      prompt:
        'scrape a list of all escape room booking times, including date, time, and available or booked',
    });
    console.log('Plan out:', plan);
  }, 180_000);
});

describe('Shopify Builder Tests', () => {
  it('should build a bot for randolphusa', async () => {
    const ws = new Workshop();
    const plan = await ws.plan({
      url: 'https://www.randolphusa.com/',
      prompt:
        'product scraper, including: product name, URL, description, and price as number + currency',
    });
    console.log('Plan out:', plan);
  }, 180_000);

  it('should build a bot for mollyjogger', async () => {
    const ws = new Workshop();
    const plan = await ws.plan({
      url: 'https://www.mollyjogger.com/',
      prompt:
        'product scraper, including: product name, URL, description, and price as number + currency',
    });
    console.log('Plan out:', plan);
  }, 180_000);
});

describe('Real Estate Leadgen Tests', () => {
  const inputSchema = z.object({
    limit: z.number().describe('max number of results to return per page').optional().default(1000),
    page: z.number().describe('page number').optional().default(1),
  });

  const outputSchema = z.object({
    name: z.string('agent name'),
    email: z.string('agent email'),
    phone: z.string('agent phone'),
    url: z.string('agent profile URL'),
    agencyName: z.string('name of the agency for this agent'),
    address: z.string('agent address (as specific as possible)'),
  });

  it('should build a bot for northeastalrealtor', async () => {
    const ws = new Workshop();
    const plan = await ws.plan({
      url: 'https://northeastalrealtor.com/realtor/',
      prompt: 'extract each agent name and email address',
      inputSchema,
      outputSchema,
    });
    console.log('Plan out:', plan);
  }, 180_000);

  it('should build a bot for coldwellbanker', async () => {
    const ws = new Workshop();
    const plan = await ws.plan({
      // url: 'https://www.coldwellbanker.com/',
      url: 'https://www.coldwellbanker.com/sitemap/agents',
      prompt: 'extract each agent name and email address',
      inputSchema,
      outputSchema,
    });
    console.log('Plan out:', plan);
  }, 180_000);

  it('should build a bot for northeastalrealtor', async () => {
    const ws = new Workshop();
    const plan = await ws.plan({
      url: 'https://northeastalrealtor.com/realtor',
      prompt: 'extract each agent name and email address',
      inputSchema,
      outputSchema,
    });
    console.log('Plan out:', plan);
  }, 180_000);

  it('should build a bot for c21', async () => {
    const ws = new Workshop();
    const plan = await ws.plan({
      url: 'https://realestatecenter.sites.c21.homes/agents-offices',
      prompt: 'extract each agent name and email address',
      inputSchema,
      outputSchema,
    });
    console.log('Plan out:', plan);
  }, 180_000);

  it('should build a bot for theagencyseattle', async () => {
    const ws = new Workshop();
    const plan = await ws.plan({
      url: 'https://theagencyseattle.com/our-brokers',
      prompt: 'extract each agent name and email address',
      inputSchema,
      outputSchema,
    });
    console.log('Plan out:', plan);
  }, 180_000);
});

// https://northeastalrealtor.com/realtor
// https://yelmoffice.johnlscott.com/find-agent
// https://westseattleoffice.johnlscott.com/find-agent
// https://realestatecenter.sites.c21.homes/directory/agents/*
// https://realestatecenter.sites.c21.homes/directory/offices/real-estate-center-4
// https://www.nostalgichomes.com/agents.php
// https://www.sothebysrealty.com/eng/associates/int/180-b-82391-4001320-brokerid
// https://theagencyseattle.com/our-brokers
// https://orca.myrealtyonegroup.com/real-estate-agents/dsort-fa/1
// https://www.bhhscalifornia.com/real-estate-office/montecito-midtown/259
