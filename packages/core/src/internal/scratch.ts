import { Workshop } from './index.js';
import { log } from './logger.js';

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
  log.info('Starting scratch run');

  const ws = new Workshop();
  const bot = await ws.build(target);

  log.debug(JSON.stringify(bot));

  const out = await bot.run(bot.exampleInput);

  log.info(JSON.stringify(out));
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    log.error(`Scratch run failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  });
