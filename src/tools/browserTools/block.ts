import { readFileSync } from 'node:fs';
import { FiltersEngine, Request as AdblockRequest } from '@ghostery/adblocker';
import type { Request } from 'playwright';
import { isMastraPlatform } from '../../constants.js';

const blocklistUrl = isMastraPlatform
  ? new URL('./data/blocklist.txt', import.meta.url)
  : new URL('../../../data/blocklist.txt', import.meta.url);
const blocklist = readFileSync(blocklistUrl, 'utf8');
const engine = FiltersEngine.parse(blocklist);

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
