import type { Page, Request } from 'playwright';
import { likelyAdOrTracker } from './block.js';

export type Readiness = { state: 'settled' | 'timeout'; elapsedMs: number; pending: number };

// Inspired by exp/visit/check: observe relevant requests and DOM stability around an action.
// No telemetry, CDP performance sessions, host exceptions or overlapping interval callbacks.
export const withReadiness = async <T>(
  page: Page,
  action: () => Promise<T>,
  { timeout = 5000, quietMs = 300 }: { timeout?: number; quietMs?: number } = {}
): Promise<{ result: T; readiness: Readiness }> => {
  const started = Date.now();
  const pending = new Set<Request>();
  let changedAt = started;
  const request = (req: Request) => {
    if (
      ['document', 'script', 'xhr', 'fetch'].includes(req.resourceType()) &&
      !likelyAdOrTracker(req)
    ) {
      pending.add(req);
      changedAt = Date.now();
    }
  };
  const finished = (req: Request) => {
    if (pending.delete(req)) {
      changedAt = Date.now();
    }
  };
  page.on('request', request);
  page.on('requestfinished', finished);
  page.on('requestfailed', finished);
  try {
    const result = await action();
    const deadline = Date.now() + timeout;
    let previous = '';
    while (Date.now() < deadline) {
      const snapshot = await page
        .evaluate(() => {
          const text = (document.body?.innerText ?? '').slice(0, 64000);
          let hash = 2166136261;
          for (let i = 0; i < text.length; i++) {
            hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
          }
          return {
            interactive: document.readyState !== 'loading',
            signature: `${location.href}:${hash}:${document.querySelectorAll('input,select,textarea,iframe,a').length}`,
          };
        })
        .catch((e) => {
          if (page.isClosed()) {
            throw e;
          }
          return { interactive: false, signature: '' };
        });
      if (snapshot.signature !== previous) {
        previous = snapshot.signature;
        changedAt = Date.now();
      }
      if (snapshot.interactive && !pending.size && Date.now() - changedAt >= quietMs) {
        return {
          result,
          readiness: { state: 'settled', elapsedMs: Date.now() - started, pending: 0 },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      result,
      readiness: { state: 'timeout', elapsedMs: Date.now() - started, pending: pending.size },
    };
  } finally {
    page.off('request', request);
    page.off('requestfinished', finished);
    page.off('requestfailed', finished);
  }
};
