import * as run from './core/run.js';
import { execute } from './core/execute';

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

const main = async () => {
  const { content, usage } = await run.runFull(target);
  console.log('Content:', content);
  console.log('Usage:', usage);

  const out = await execute(content, {});
  console.log('Out:', out);
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
