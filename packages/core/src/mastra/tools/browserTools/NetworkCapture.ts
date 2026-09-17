import { randomUUID } from 'node:crypto';
import type { Page, Request, Response } from 'playwright';
import {
  documentContentTypes,
  type DocumentLibrary,
  type DocumentSummary,
} from '../../../documents/index.js';
import { log } from '../../../logger.js';
import { parseResponseBody } from '../../../util/index.js';
import { likelyAdOrTracker } from './block.js';

const captures = new WeakMap<Page, NetworkCapture>();

export class NetworkCapture {
  id = '';
  private requests = new WeakMap<Request, string>();
  private ids: string[] = [];
  private listeners = new Set<() => void>();
  private closed = false;

  constructor(
    private page: Page,
    private library: DocumentLibrary,
    private cursorId: string,
    private proxy: string
  ) {
    page.on('request', this.onRequest);
    page.on('response', this.onResponse);
    page.once('close', () => this.close());
  }

  static for(
    page: Page,
    library: DocumentLibrary,
    cursorId: string,
    proxy: string
  ): NetworkCapture {
    let capture = captures.get(page);
    if (!capture) {
      capture = new NetworkCapture(page, library, cursorId, proxy);
      captures.set(page, capture);
    }
    return capture;
  }

  begin(): string {
    this.id = randomUUID();
    this.ids = [];
    return this.id;
  }

  private onRequest = (request: Request): void => {
    if (['fetch', 'xhr'].includes(request.resourceType()) && !likelyAdOrTracker(request)) {
      this.requests.set(request, this.id);
    }
  };

  private onResponse = (resp: Response): void => {
    void this.capture(resp).catch((e) =>
      log.warn(`Could not capture browser response ${resp.url()}: ${String(e)}`)
    );
  };

  private async capture(resp: Response): Promise<void> {
    const request = resp.request();
    const captureId = this.requests.get(request);
    if (!captureId || (resp.status() >= 300 && resp.status() < 400)) {
      return;
    }
    const headers = await resp.allHeaders();
    const mime = headers['content-type']?.split(';')[0].trim().toLowerCase();
    const contentType = documentContentTypes.find((type) => type === mime);
    if (!contentType || Number(headers['content-length']) > 2_000_000) {
      return;
    }
    const body = await resp.body();
    if (body.byteLength > 2_000_000 || this.closed) {
      return;
    }
    const id = this.library.save({
      url: resp.url(),
      origin: 'dynamic',
      contentType,
      status: resp.status(),
      headers,
      request: {
        timestamp: new Date().toISOString(),
        headers: request.headers(),
        proxy: this.proxy,
        mode: 'browser',
        cursorId: this.cursorId,
        captureId,
        method: request.method?.() ?? 'GET',
        body: request.postData?.() ?? null,
        frameUrl: request.frame?.().url() ?? null,
      },
      content: parseResponseBody(contentType, body),
    });
    if (captureId === this.id) {
      this.ids = [...new Set([...this.ids, id])].slice(-200);
      for (const listener of this.listeners) {
        listener();
      }
    }
  }

  list(urlPrefix = '', contentType?: string): DocumentSummary[] {
    return this.ids.flatMap((id) => {
      const doc = this.library.summary(id);
      return doc?.url.startsWith(urlPrefix) && (!contentType || doc.contentType === contentType)
        ? [doc]
        : [];
    });
  }

  async wait(
    urlPrefix: string,
    minCount: number,
    timeout: number,
    contentType?: string
  ): Promise<DocumentSummary[]> {
    if (this.list(urlPrefix, contentType).length >= minCount) {
      return this.list(urlPrefix, contentType);
    }
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
      };
      const check = () => {
        if (this.closed) {
          finish();
          reject(new Error('Browser closed during capture'));
        } else if (this.list(urlPrefix, contentType).length >= minCount) {
          finish();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        finish();
        reject(
          new Error(`Timed out waiting for ${minCount} captured responses matching ${urlPrefix}`)
        );
      }, timeout);
      this.listeners.add(check);
      check();
    });
    return this.list(urlPrefix, contentType);
  }

  close(): void {
    this.closed = true;
    this.page.off('request', this.onRequest);
    this.page.off('response', this.onResponse);
    for (const listener of this.listeners) {
      listener();
    }
    this.listeners.clear();
  }
}
