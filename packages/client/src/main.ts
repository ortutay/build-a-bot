import { z } from 'zod';
import { DataService, DataSource } from '@build-a-bot/core';

const service = new DataService({
  name: 'pokemon-7',
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
    new DataSource({ url: 'https://pokemondb.net/pokedex/national' }),
    new DataSource({ url: 'https://pokemondb.net/pokedex/bulbasaur' }),
    new DataSource({ url: 'https://pokemondb.net/pokedex/pikachu' }),
  ],
});

console.log('service:', service);

await service.build();
const out1 = await service.sync([
  'https://pokemondb.net/pokedex/bulbasaur',
  'https://pokemondb.net/pokedex/charmander',
  'https://pokemondb.net/pokedex/national',
]);
console.log('out1:', out1);
