import { Workshop } from './index.js';
import { fetchTool } from './tools/FetchTool.js';
import { Agent } from './agent/Agent.js';
// import { build } from './index.js';

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
  console.log('main', target);
  // console.log('ft', fetchTool);
  // const out = await fetchTool.run({ url: 'https://example.com' });
  // console.log('Out gave:', out);

  // const agent = new Agent({
  //   model: 'google/gemini-3.5-flash-lite',
  //   tools: [fetchTool],
  // });
  // const out = await agent.run('get example.com html');

  const ws = new Workshop();
  const bot = await ws.build({
    ...target,
    agentOptions: {
      model: 'google/gemini-3.5-flash-lite',
      tools: [fetchTool],
    },
  });

  return;

  // console.log('got bot:', bot);

  // const { fn, code, usage } = await build(target);
  // const out = await fn({});
  // console.log('Code:', code);
  // console.log('Usage:', usage);
  // console.log('Out:', out);
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
