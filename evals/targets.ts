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
