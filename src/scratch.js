import { build } from './index.js';

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
  const { fn, code, usage } = await build(target);
  const out = await fn({});
  console.log('Code:', code);
  console.log('Usage:', usage);
  console.log('Out:', out);

  // const { content, usage } = await run.runFull(target);
  // const out = await execute(content, {});
  // console.log('Out:', out);
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
