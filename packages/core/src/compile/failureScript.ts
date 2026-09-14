// Preserve a failed group's seed routes without fabricating data or removals.
export const failureScript = (urls: string[], error: string): string => `
  export const itemSchema = { type: 'object' };
  export const uniqueId = () => '000000000000';
  export const check = async url => ${JSON.stringify(urls)}.includes(url);
  export const run = async url => { throw new Error(${JSON.stringify(error)}); };
`;
