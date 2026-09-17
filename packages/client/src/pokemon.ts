import process from 'node:process';
import { z } from 'zod';
import { DataService, DataSource } from '@build-a-bot/core';
import { createClientContext } from './timo/proxies.js';

const service = new DataService({
  name: 'pokemon-9',
  context: await createClientContext(),
  identity: { fields: [{ path: 'number', normalize: 'digits' }] },
  itemSchema: z.object({
    name: z
      .string()
      .describe(
        'pokemon name. note, you are in a test/dev context, focused on URL groupings, so try to work quickly, even if it means sacrificing a little bit of quality'
      ),
    number: z.string().describe('pokemon number'),
    hp: z.string().describe('pokemon hit points'),
    height: z.number().describe('pokemon height in meters'),
    weight: z.number().describe('pokemon weight in kg'),
  }),
  sources: [
    // new DataSource({ url: 'https://pokemondb.net/pokedex/national' }),
    new DataSource({ url: 'https://pokemondb.net/pokedex/bulbasaur' }),
    new DataSource({ url: 'https://pokemondb.net/pokedex/pikachu' }),
  ],
});

await service.start();
const out1 = await service.sync([
  'https://pokemondb.net/pokedex/bulbasaur',
  'https://pokemondb.net/pokedex/charmander',
  // 'https://pokemondb.net/pokedex/national',
]);
console.log('out1:', out1);
process.exit(out1.outcome.errors.length || out1.outcome.unhandled.length ? 1 : 0);
