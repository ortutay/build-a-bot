import { Workshop } from './index.js';

const target = {
  url: 'https://pokemondb.net/pokedex/national',
  prompt:
    'scrape pokemon: name, number, and basic stats including HP. input should take multiple pokemon names a list',
};

// const target = {
//   url: 'https://uk.rubix.com/en/adhesive-tapes/c-50-15-20',
//   prompt: 'Scrape all tape products: price (number + currency), dimensions, and other standard details.',
// };

const main = async () => {
  console.log('main');

  const ws = new Workshop();
  const bot = await ws.build(target);

  console.log('Got bot:', bot);

  const out = await bot.run(bot.exampleInput);

  console.log('Bot output:', JSON.stringify(out, null, 2));
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
