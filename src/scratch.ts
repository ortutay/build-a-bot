import { pick } from 'radash';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { ConsoleLogger } from '@mastra/core/logger';
import { Mastra } from '@mastra/core';
import { ResponseCache, type ResponseCacheKeyInputs } from '@mastra/core/processors';
import { RedisServerCache } from '@mastra/redis';
import { MCPClient } from '@mastra/mcp';

import { hash } from './util.js';
import { Compiler } from './compile/Compiler.js';
import { fetchTool, viewDocumentTool } from './tools/fetchTool.js';
import { brightdataApiKey, firecrawlApiKey, scrapingbeeApiKey } from './constants.js';
import * as templates from './prompts/templates.js';

import { Workshop } from './index.js';

// import { Agent } from './agent/Agent.js';
// import { fetchTool, jsFetchTool } from './tools/index.js';

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
  console.log('main');

  const ws = new Workshop();
  const bot = await ws.build({ ...target, agentOptions: {} });

  console.log('Got bot:', bot);
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
