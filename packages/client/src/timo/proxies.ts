import { BrightDataRequestProxy, CdpProxy, NoProxy, type Proxy } from '@build-a-bot/core';
import {
  brightdataApiKey,
  proxyResidentialCdpUrl,
  proxyUnblockApiUrl,
  proxyUnblockZone,
} from '../constants.js';

export const proxies = (): Proxy[] => {
  return [new NoProxy()];
};

// export const proxies: Proxy[] = [new NoProxy()]; // TODO

// export const proxies = (): Proxy[] => {
//   if (!brightdataApiKey || !proxyUnblockApiUrl || !proxyUnblockZone) {
//     throw new Error(
//       'Load the .env containing BRIGHTDATA_API_KEY and the existing unlocker URL/zone.'
//     );
//   }
//   const result: Proxy[] = [
//     new NoProxy(),
//     new BrightDataRequestProxy('unlock', {
//       apiKey: brightdataApiKey,
//       requestUrl: proxyUnblockApiUrl,
//       zone: proxyUnblockZone,
//     }),
//   ];
//   if (proxyResidentialCdpUrl) {
//     result.push(new CdpProxy('residential-browser', proxyResidentialCdpUrl));
//   }
//   return result;
// };
