import { FiltersEngine, Request as AdblockRequest } from '@ghostery/adblocker';
import type { Request } from 'playwright';
import { list } from './blocklist.js';

const engine = FiltersEngine.parse(list);

export const likelyAdOrTracker = (request: Request): boolean => {
  const type = request.resourceType();
  if (type !== 'fetch' && type !== 'xhr') {
    return false;
  }

  let sourceUrl = '';
  try {
    sourceUrl = request.frame().url();
  } catch (e) {
    // Conservatively allow worker-originated requests whose frame is unavailable.
  }

  return engine.match(
    AdblockRequest.fromRawDetails({
      url: request.url(),
      sourceUrl,
      type,
    })
  ).match;
};
