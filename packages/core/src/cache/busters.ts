const global: string = 'g' + 15;

export const cb: Record<string, string> = {
  global,
  browserToolCache: 'btc' + global + 2,
  cacheInstrument: 'ci' + global + 2,
  documentLibrary: 'dl' + global + 1,
  mastraResponse: 'mr' + global + 4,
  mastraResponseCache: 'mrc' + global + 1,
};
