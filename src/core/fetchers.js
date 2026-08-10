import { Browser, BrowserErrorCaptureEnum } from 'happy-dom';
import { retry } from './util.js';
import { proxyFetch } from './proxy.js';

export const retryFetch = (...args) => retry(() => fetch(...args));

export const nodeFetch = (url, options = {}, proxy = 'none') => {
  console.log('nodeFetch:', url, options, proxy);
  return proxyFetch(url, proxy, options.headers);
};

export const jsFetch = async (url, proxy = 'none') => {
  const browser = new Browser({
    settings: {
      errorCapture: BrowserErrorCaptureEnum.processLevel,
      fetch: {
        interceptor: {
          beforeAsyncRequest: async ({ request, window }) => {
            const resp = await proxyFetch(request.url, proxy, request.headers);
            return new window.Response(await resp.text(), {
              status: resp.status,
              statusText: resp.statusText,
              headers: resp.headers,
            });
          },
        },
      },
    },
  });
  const page = browser.newPage();
  const resp = await page.goto(url);
  await page.waitUntilComplete();
  return {
    status: resp.status,
    html: page.mainFrame.document.documentElement.outerHTML,
  };
};
