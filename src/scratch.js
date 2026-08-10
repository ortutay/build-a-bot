import * as run from './run.js';

import { Builder } from './core/builder.ts';

// Edit this target freely while experimenting with the agent.
const target = {
  url: 'https://pokemondb.net/pokedex/national',
  prompt: ' pokemon: name, number, and basic stats including HP',
};

// const target = {
//   url: "https://uk.rubix.com/en/adhesive-tapes/c-50-15-20",
//   prompt:
//     "Scrape all tape products: EUR price, dimensions, and other standard details.",
// };

run
  .runFull(target)
  .then(({ content, usage }) => {
    console.log('Output:', content);
    console.log('Usage:', usage);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
