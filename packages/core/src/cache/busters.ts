const global: string = 'g' + 15;

export const cb: Record<string, string> = {
  global,
  browserToolCache: 'btc' + global + 3,
  cacheInstrument: 'ci' + global + 2,
  dataServiceBuild: 'dsb' + global + 5,
  documentLibrary: 'dl' + global + 1,
  mastraResponse: 'mr' + global + 5,
  mastraResponseCache: 'mrc' + global + 2,
};
