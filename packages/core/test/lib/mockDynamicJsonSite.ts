import http, { type ServerResponse } from 'node:http';

const catalog = {
  products: [
    { id: 'json-widget', name: 'JSON Widget', price: 24 },
    { id: 'json-gadget', name: 'JSON Gadget', price: 36 },
  ],
};

const sendHtml = (resp: ServerResponse, body: string): void => {
  resp.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  resp.end(body);
};

const sendJson = (resp: ServerResponse, body: unknown): void => {
  resp.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  resp.end(JSON.stringify(body));
};

export const startMockDynamicJsonSite = async () => {
  const server = http.createServer((req, resp) => {
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/') {
      sendHtml(
        resp,
        `<!doctype html>
        <html lang="en">
          <body>
            <main id="catalog">Loading catalog…</main>
            <script>
              fetch('/api/catalog')
                .then((resp) => resp.json())
                .then(({ products }) => {
                  document.querySelector('#catalog').innerHTML = products
                    .map((product) => '<article data-product-id="' + product.id + '">' + product.name + '</article>')
                    .join('');
                });
            </script>
          </body>
        </html>`
      );
      return;
    }

    if (url.pathname === '/api/catalog') {
      sendJson(resp, catalog);
      return;
    }

    resp.writeHead(404);
    resp.end();
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
    throw new Error('Mock dynamic JSON server did not bind to a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      });
    },
  };
};
