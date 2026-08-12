import { names } from '../proxy.js';

export const url = {
  type: 'string',
  description: 'URL to navigate to. Include the scheme, for example https://.',
} as const;

export const proxy = {
  type: 'string',
  enum: names,
  description: `Proxy setting to use.`,
} as const;
