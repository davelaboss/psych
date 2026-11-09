import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import handler, { createProductPageHandler } from '../product-page.mjs';

const origin = 'https://private-preview.example';
const product = {
  id: 'product-1',
  itemNumber: 1,
  slug: 'camera-item-1',
  title: 'Cámara de prueba',
  status: 'AVAILABLE',
  quantityRemaining: 1,
  images: ['/images/camera.webp'],
};
const readBundledShell = () => readFile('index.html', 'utf8');

test('default handler reads the bundled storefront without an unauthenticated HTTP request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Protected homepage must not be requested');
  });
  const response = await handler(new Request(origin + '/.netlify/functions/product-page'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(await response.text(), await readBundledShell());
  assert.equal(fetch.mock.callCount(), 0);
});

test('private and production product routes preserve catalog lookup and social metadata', async t => {
  const previousURL = process.env.URL;
  process.env.URL = 'https://thelabossieres.com';
  t.after(() => previousURL === undefined ? delete process.env.URL : process.env.URL = previousURL);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No shell HTTP request'); });
  for (const requestOrigin of [origin, 'https://thelabossieres.com']) {
    const calls = [];
    const route = createProductPageHandler({ loadProducts: async (...args) => {
      calls.push(args);
      return { products: [product] };
    } });
    const response = await route(new Request(requestOrigin + '/producto/' + product.slug));
    const html = await response.text();
    assert.deepEqual(calls, [[requestOrigin, { requestedSlug: product.slug }]]);
    assert.equal(response.status, 200);
    assert.match(html, /property="og:title" content="Cámara de prueba"/);
    assert.match(html, /rel="canonical" href="https:\/\/thelabossieres\.com\/producto\/camera-item-1"/);
    assert.match(html, /property="og:image" content="https:\/\/thelabossieres\.com\/\.netlify\/images\?url=%2Fimages%2Fcamera\.webp/);
    assert.match(html, /id="app"|id="catalog-search"/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('HEAD retains GET status and headers with no response body', async () => {
  const route = createProductPageHandler({ loadProducts: async () => ({ products: [product] }) });
  const requestURL = origin + '/producto/' + product.slug;
  const get = await route(new Request(requestURL));
  const head = await route(new Request(requestURL, { method: 'HEAD' }));
  assert.equal(head.status, get.status);
  assert.deepEqual([...head.headers], [...get.headers]);
  assert.equal(await head.text(), '');
  assert.match(await get.text(), /Cámara de prueba/);
});

test('unknown products and catalog errors retain the storefront shell', async t => {
  const shell = await readBundledShell();
  const log = t.mock.method(console, 'error', () => {});
  for (const loadProducts of [async () => ({ products: [] }), async () => { throw new Error('Catalog unavailable'); }]) {
    const route = createProductPageHandler({ loadProducts });
    const response = await route(new Request(origin + '/producto/unknown-item'));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), shell);
  }
  assert.equal(log.mock.callCount(), 1);
});

test('unsupported methods never read the shell or access the catalog', async () => {
  const route = createProductPageHandler({
    readShell: async () => { assert.fail('Unexpected shell read'); },
    loadProducts: async () => { assert.fail('Unexpected catalog access'); },
  });
  const response = await route(new Request(origin + '/producto/' + product.slug, { method: 'POST' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('a missing bundle fails closed without falling back to the protected homepage', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { assert.fail('Unexpected HTTP fallback'); });
  const missing = Object.assign(new Error('Missing bundled HTML'), { code: 'ENOENT' });
  const route = createProductPageHandler({ readShell: async () => { throw missing; } });
  await assert.rejects(route(new Request(origin + '/producto/' + product.slug)), error => error === missing);
  assert.equal(fetch.mock.callCount(), 0);
});
