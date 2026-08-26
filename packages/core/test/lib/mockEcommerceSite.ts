import http, { type ServerResponse } from 'node:http';

type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
};

type Category = {
  slug: string;
  name: string;
  products: Product[];
};

type RecordedRequest = {
  method: string;
  path: string;
  search: string;
};

const createProducts = (category: string, names: string[], startingPrice: number): Product[] =>
  names.map((name, index) => ({
    id: `${category}-${index + 1}`,
    name,
    price: startingPrice + index * 4,
    category,
  }));

const footwearProducts = createProducts(
  'footwear',
  [
    'Red Sneakers',
    'Blue Running Shoes',
    'Canvas Sneakers',
    'Trail Boots',
    'Leather Loafers',
    'Green Sandals',
    'City Walking Shoes',
    'High-Top Sneakers',
    'Rain Boots',
    'House Slippers',
    'Tennis Shoes',
    'Hiking Sandals',
  ],
  39
);

const electronicsProducts = createProducts(
  'electronics',
  [
    'Pocket Radio',
    'Wireless Headphones',
    'USB-C Charger',
    'Mechanical Keyboard',
    'Travel Mouse',
    'Desk Speakers',
    'Portable Projector',
    'Smart Alarm Clock',
    'Noise-Canceling Earbuds',
    'Fitness Watch',
    'Reading Light',
    'Web Camera',
    'Tablet Stand',
    'Bluetooth Tracker',
    'Mini Power Bank',
  ],
  25
);

const homeProducts = createProducts(
  'home',
  [
    'Ceramic Coffee Mug',
    'Linen Throw Pillow',
    'Wool Blanket',
    'Oak Serving Tray',
    'Glass Water Bottle',
    'Cotton Bath Towel',
    'Bamboo Plant Stand',
    'Scented Candle',
    'Kitchen Timer',
    'Storage Basket',
    'Reading Pillow',
    'Wall Calendar',
    'Desk Organizer',
    'Garden Planter',
    'Picnic Blanket',
    'Tea Kettle',
    'Table Lamp',
    'Welcome Mat',
  ],
  12
);

export const categories: Category[] = [
  { slug: 'footwear', name: 'Footwear', products: footwearProducts },
  { slug: 'electronics', name: 'Electronics', products: electronicsProducts },
  { slug: 'home', name: 'Home', products: homeProducts },
];

export const products = categories.flatMap((category) => category.products);

const escapeHtml = (value: string | number): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const layout = (title: string, content: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)} | Fox Shop</title>
  </head>
  <body>
    <header>
      <a id="home-link" href="/">Fox Shop</a>
      <form id="search-form" action="/search" method="get">
        <label>Search <input id="search-input" name="q"></label>
        <button type="submit">Search</button>
      </form>
      <div id="cart">Cart: <span id="cart-count">0</span></div>
    </header>
    <main>${content}</main>
  </body>
</html>`;

const productCard = (product: Product): string => `
  <article class="product-card" data-product-id="${escapeHtml(product.id)}">
    <h2><a href="/products/${escapeHtml(product.id)}">${escapeHtml(product.name)}</a></h2>
    <p class="price">$${product.price.toFixed(2)}</p>
  </article>`;

const homepage = (): string =>
  layout(
    'Home',
    `<h1>Fox Shop</h1>
    <nav id="categories">
      ${categories
        .map(
          (category) =>
            `<a class="category-link" href="/categories/${category.slug}">${escapeHtml(category.name)}</a>`
        )
        .join('\n')}
    </nav>
    <section id="featured-products">
      <h2>Featured products</h2>
      ${categories.map((category) => productCard(category.products[0])).join('\n')}
    </section>
    <button id="add-to-cart" type="button">Add featured product to cart</button>
    <div id="delayed-offer-container"></div>
    <script>
      document.querySelector('#add-to-cart').addEventListener('click', () => {
        const count = document.querySelector('#cart-count');
        count.textContent = String(Number(count.textContent) + 1);
        document.body.dataset.cartUpdated = 'true';
      });

      setTimeout(() => {
        const offer = document.createElement('p');
        offer.id = 'delayed-offer';
        offer.textContent = 'Free shipping';
        document.querySelector('#delayed-offer-container').append(offer);
      }, 25);
    </script>`
  );

const categoryPage = (category: Category, requestedPage: number): string => {
  const pageSize = 10;
  const pageCount = Math.ceil(category.products.length / pageSize);
  const page = Math.min(Math.max(requestedPage, 1), pageCount);
  const start = (page - 1) * pageSize;
  const visibleProducts = category.products.slice(start, start + pageSize);

  return layout(
    category.name,
    `<h1>${escapeHtml(category.name)}</h1>
    <p id="pagination-summary">Page ${page} of ${pageCount}</p>
    <section id="product-list">${visibleProducts.map(productCard).join('\n')}</section>
    <nav id="pagination">
      ${page > 1 ? `<a id="previous-page" href="?page=${page - 1}">Previous</a>` : ''}
      ${page < pageCount ? `<a id="next-page" href="?page=${page + 1}">Next</a>` : ''}
    </nav>`
  );
};

const productPage = (product: Product): string =>
  layout(
    product.name,
    `<article id="product" data-product-id="${escapeHtml(product.id)}">
      <h1 id="product-name">${escapeHtml(product.name)}</h1>
      <p id="product-price">$${product.price.toFixed(2)}</p>
      <p id="inventory">In stock</p>
      <a id="category-link" href="/categories/${escapeHtml(product.category)}">View category</a>
    </article>`
  );

const searchPage = (query: string): string => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? products.filter((product) => product.name.toLocaleLowerCase().includes(normalizedQuery))
    : [];

  return layout(
    'Search',
    `<h1>Search results</h1>
    <p id="search-summary">${matches.length} results for “${escapeHtml(query)}”</p>
    <section id="search-results">${matches.map(productCard).join('\n')}</section>`
  );
};

const notFoundPage = (): string =>
  layout('Not Found', '<h1>Page not found</h1><p>The requested product does not exist.</p>');

const sendHtml = (resp: ServerResponse, status: number, body: string): void => {
  resp.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  resp.end(body);
};

export const startMockEcommerceSite = async () => {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, resp) => {
    const url = new URL(req.url || '/', 'http://localhost');
    requests.push({
      method: req.method || 'GET',
      path: url.pathname,
      search: url.search,
    });

    const categoryMatch = url.pathname.match(/^\/categories\/([^/]+)$/);
    const productMatch = url.pathname.match(/^\/products\/([^/]+)$/);

    if (url.pathname === '/') {
      sendHtml(resp, 200, homepage());
    } else if (categoryMatch) {
      const category = categories.find((item) => item.slug === categoryMatch[1]);
      const requestedPage = Number.parseInt(url.searchParams.get('page') || '1', 10);
      if (category) {
        sendHtml(
          resp,
          200,
          categoryPage(category, Number.isNaN(requestedPage) ? 1 : requestedPage)
        );
      } else {
        sendHtml(resp, 404, notFoundPage());
      }
    } else if (productMatch) {
      const product = products.find((item) => item.id === productMatch[1]);
      sendHtml(resp, product ? 200 : 404, product ? productPage(product) : notFoundPage());
    } else if (url.pathname === '/search') {
      sendHtml(resp, 200, searchPage(url.searchParams.get('q') || ''));
    } else {
      sendHtml(resp, 404, notFoundPage());
    }
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
    throw new Error('Mock e-commerce server did not bind to a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    requestCount(path?: string) {
      return path ? requests.filter((request) => request.path === path).length : requests.length;
    },
    resetRequests() {
      requests.length = 0;
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
