import { STATUS_CODES } from 'node:http';
import { Proxy } from './Proxy.js';

export type BrightDataRequestProxyOptions = {
  apiKey?: string;
  requestUrl?: string;
  timeoutMs?: number;
  zone?: string;
};

const requireOption = (proxy: string, name: string, val: string | undefined): string => {
  if (!val) {
    throw new Error(`Proxy tier "${proxy}" requires ${name} to be configured.`);
  }
  return val;
};

export class BrightDataRequestProxy extends Proxy {
  readonly type = 'http' as const;

  readonly apiKey: string | undefined;
  readonly requestUrl: string | undefined;
  readonly timeoutMs: number;
  readonly zone: string | undefined;

  constructor(id: string, options: BrightDataRequestProxyOptions) {
    super(id);
    this.apiKey = options.apiKey;
    this.requestUrl = options.requestUrl;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.zone = options.zone;
  }

  async fetch(url: string, headers: HeadersInit = {}): Promise<Response> {
    const resp = await fetch(requireOption(this.id, 'a request URL', this.requestUrl), {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${requireOption(this.id, 'an API key', this.apiKey)}`,
      },
      body: JSON.stringify({
        zone: requireOption(this.id, 'a zone', this.zone),
        url,
        format: 'raw',
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    // The REST endpoint may return 200 even when the target request failed.
    let status = resp.status;
    const targetStatus = Number(resp.headers.get('x-brd-status-code'));
    if (Number.isInteger(targetStatus) && targetStatus >= 200 && targetStatus <= 599) {
      status = targetStatus;
    }
    let body = resp.body;
    if ([204, 205, 304].includes(status)) {
      await body?.cancel();
      body = null;
    }
    const result = new Response(body, {
      headers: resp.headers,
      status,
      statusText: STATUS_CODES[status] ?? resp.statusText,
    });
    // Expose the target URL, not the REST endpoint's URL.
    Object.defineProperty(result, 'url', { value: url });
    return result;
  }
}
