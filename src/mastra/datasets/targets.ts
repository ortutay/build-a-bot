import { z } from 'zod';

const realEstateTarget = {
  goal: 'extract each agent name and email address',
  inputSchema: z.object({
    limit: z.number().describe('max number of results to return per page').optional().default(1000),
    page: z.number().describe('page number').optional().default(1),
  }),
  outputSchema: z.object({
    name: z.string('agent name'),
    email: z.string('agent email'),
    phone: z.string('agent phone'),
    url: z.string('agent profile URL'),
    agencyName: z.string('name of the agency for this agent'),
    address: z.string('agent address (as specific as possible)'),
  }),
};

const realEstateUrls = [
  'https://northeastalrealtor.com/realtor',
  'https://yelmoffice.johnlscott.com/find-agent',
  'https://westseattleoffice.johnlscott.com/find-agent',
  'https://realestatecenter.sites.c21.homes/agents-offices',
  'https://www.nostalgichomes.com/agents.php',
  'https://www.sothebysrealty.com/eng/associates/int/180-b-82391-4001320-brokerid',
  'https://theagencyseattle.com/our-brokers',
  'https://orca.myrealtyonegroup.com/real-estate-agents/dsort-fa/1',
  'https://www.bhhscalifornia.com/real-estate-office/montecito-midtown/259',
];

export const realEstateTargets = realEstateUrls.map((url) => ({
  url,
  ...realEstateTarget,
}));

export const basicTargets = [
  {
    url: 'https://pokemondb.net/pokedex/national',
    goal: 'scrape pokemon: name, number, basic stats including HP, and a list of move names. input is pokemon names, either single string or a list of names',
    inputSchema: z.object({
      names: z.array(z.string()).describe('list of pokemon to scrape'),
    }),
    exampleInput: {
      names: ['pikachu', 'squirtle'],
    },
  },
  {
    url: 'https://books.toscrape.com/catalogue/page-1.html',
    goal: 'extract each book title, price, and availability from the catalogue page',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .positive()
        .describe('number of books to retrieve')
        .optional()
        .default(10),
      offset: z
        .number()
        .int()
        .nonnegative()
        .describe('number of books to skip')
        .optional()
        .default(0),
    }),
    exampleInput: {
      limit: 10,
      offset: 0,
    },
  },
  {
    url: 'https://quotes.toscrape.com/page/1/',
    goal: 'extract each quote text, author, and tag names from the page',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .positive()
        .describe('number of quotes to retrieve')
        .optional()
        .default(10),
      offset: z
        .number()
        .int()
        .nonnegative()
        .describe('number of quotes to skip')
        .optional()
        .default(0),
    }),
    exampleInput: {
      limit: 10,
      offset: 0,
    },
  },
  {
    url: 'https://news.ycombinator.com/',
    goal: 'extract each story title, URL, score, submitting user, and comment count from the front page',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .positive()
        .describe('number of stories to retrieve')
        .optional()
        .default(10),
      offset: z
        .number()
        .int()
        .nonnegative()
        .describe('number of stories to skip')
        .optional()
        .default(0),
    }),
    exampleInput: {
      limit: 10,
      offset: 0,
    },
  },
  {
    url: 'https://en.wikipedia.org/wiki/List_of_largest_companies_in_the_United_States_by_revenue',
    goal: 'extract each company rank, name, revenue, profit, assets, market value, employee count, and headquarters',
    inputSchema: z.object({}),
    exampleInput: {},
  },
  {
    url: 'https://developer.mozilla.org/en-US/docs/Web/API',
    goal: 'extract the title and main article text from an MDN Web API documentation page',
    inputSchema: z.object({
      path: z
        .string()
        .describe('MDN documentation path below /en-US/docs, such as Web/API/Fetch_API'),
    }),
    exampleInput: {
      path: 'Web/API/Fetch_API',
    },
  },
];
