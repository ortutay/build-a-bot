import type { Tool } from '@mastra/core/tools';

export type AnyTool = Tool<any, any, any, any, any, any, any>;

export const parseUrl = (val: string): string => {
  try {
    new URL(val);
    return val;
  } catch (e) {
    throw new TypeError(`Invalid URL: ${val}`, { cause: e });
  }
};

export const parseDomain = (val: string): string => {
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(val)) {
    throw new TypeError(`Invalid domain: ${val}`);
  }

  return val;
};
