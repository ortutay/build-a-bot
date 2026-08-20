import http from 'node:http';

const page = `<!doctype html>
<html lang="en">
  <head><title>Delayed catalog</title></head>
  <body>
    <main>
      <h1 id="catalog-title">Delayed catalog</h1>
      <p class="description">A small local catalog used for browser-planning cache tests.</p>
      <ul id="products">
        <li data-sku="alpha">Alpha widget</li>
        <li data-sku="beta">Beta widget</li>
      </ul>
    </main>
  </body>
</html>`;

const waitFor = (value: string | null): number => {
  const wait = Number(value);
  return Number.isFinite(wait) && wait >= 0 ? wait : 0;
};

export const startMockWaitHttp = async () => {
  const requests: number[] = [];
  const server = http.createServer((req, resp) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const wait = waitFor(url.searchParams.get('wait'));
    requests.push(wait);

    setTimeout(() => {
      resp.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      });
      resp.end(page);
    }, wait);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error) => {
      server.off('listening', onListening);
      reject(e);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock wait HTTP server did not bind to a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCount(wait?: number) {
      return wait === undefined
        ? requests.length
        : requests.filter((request) => request === wait).length;
    },
    async close() {
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      });
    },
  };
};
