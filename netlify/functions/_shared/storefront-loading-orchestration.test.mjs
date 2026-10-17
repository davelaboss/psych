import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [homepage, site, checkout, catalogController] = await Promise.all([
  readFile(new URL('../../../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../../js/site.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../js/checkout.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../js/volume2-storefront.js', import.meta.url), 'utf8'),
]);

function sourceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  assert.notEqual(start, -1, `Missing ${startToken}`);
  assert.notEqual(end, -1, `Missing ${endToken}`);
  return source.slice(start, end);
}

function createCatalogLoader(fetchImplementation) {
  const loaderSource = sourceBetween(
    site,
    'function loadAuthoritativeCatalog',
    'async function bootStaticStorefront'
  );
  const browserWindow = { location: { origin: 'https://example.test' } };
  const loader = Function(
    'window',
    'fetch',
    'URL',
    `${loaderSource}; return loadAuthoritativeCatalog;`
  )(browserWindow, fetchImplementation, URL);
  return { browserWindow, loader };
}

test('homepage hides the committed catalog behind a truthful state before scripts boot', () => {
  assert.match(homepage, /initialPath === '\/'[\s\S]*?classList\.add\('catalog-route-pending'\)/);
  assert.match(homepage, /catalog-route-pending \.catalog > :not\(\.catalog-loading-state\) \{ display: none !important; \}/);
  assert.match(homepage, /class="catalog-loading-state empty-cart"[\s\S]*?Cargando artículos…/);
  assert.match(homepage, /catalog-route-pending \.catalog-loading-state \{ display: block; \}/);
});

test('homepage success clears pending only after catalog construction and failure replaces stale content', () => {
  const buildCatalog = sourceBetween(catalogController, 'function buildCatalog()', 'function prepareControls');
  const renderError = sourceBetween(catalogController, 'function renderCatalogError()', 'function renderDeliveredProductView');

  assert.match(buildCatalog, /grid\.innerHTML = ''/);
  assert.match(buildCatalog, /classList\.remove\('catalog-route-pending'\)/);
  assert.match(renderError, /catalog\.innerHTML =/);
  assert.match(renderError, /No mostramos información desactualizada/);
  assert.match(renderError, /classList\.remove\('catalog-route-pending'\)/);
});

test('shared authoritative catalog promise performs one fresh request and shares its result', async () => {
  let calls = 0;
  let release;
  const responseReady = new Promise((resolve) => { release = resolve; });
  const { browserWindow, loader } = createCatalogLoader(async (url, options) => {
    calls += 1;
    assert.equal(url.pathname, '/.netlify/functions/volume2-catalog');
    assert.equal(options.cache, 'no-store');
    await responseReady;
    return {
      ok: true,
      async json() {
        return { products: [{ id: 'new-product' }], deliveredProduct: null };
      },
    };
  });

  const first = loader();
  const second = loader();
  assert.strictEqual(first, second);
  assert.equal(calls, 1);

  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.strictEqual(firstResult, secondResult);
  assert.deepEqual(browserWindow.__catalogProducts, [{ id: 'new-product' }]);
  assert.equal(calls, 1);
});

test('shared catalog errors propagate through the same promise without revealing stale data', async () => {
  let calls = 0;
  const { browserWindow, loader } = createCatalogLoader(async () => {
    calls += 1;
    return {
      ok: false,
      async json() { return { error: 'Catálogo temporalmente no disponible.' }; },
    };
  });

  const first = loader();
  const second = loader();
  assert.strictEqual(first, second);
  await assert.rejects(first, /temporalmente no disponible/);
  await assert.rejects(second, /temporalmente no disponible/);
  assert.equal(calls, 1);
  assert.equal(browserWindow.__catalogProducts, undefined);
});

test('cart has one boot owner, one normal synchronization, and no false empty rendering', () => {
  const cartBoot = sourceBetween(site, 'async function renderSynchronizedCartPage()', 'function renderCartLoadError');
  const cartRender = sourceBetween(site, 'function renderCartPage()', 'function startCartCountdown');

  assert.match(homepage, /classList\.add\('cart-route-pending'\)/);
  assert.match(homepage, /data-route-loading="cart"[\s\S]*?Cargando carrito…/);
  assert.match(site, /window\.__staticCartReady = syncStaticCartFromServer\(\{ migrateLegacy: true \}\)/);
  assert.match(site, /if \(path === '\/carrito'\) \{[\s\S]*?await renderSynchronizedCartPage\(\)/);
  assert.doesNotMatch(catalogController, /path === '\/carrito'[\s\S]*?renderCartPage/);
  assert.doesNotMatch(cartRender, /syncStaticCartFromServer/);
  assert.match(cartBoot, /if \(!window\.__staticCartSynchronized\)/);
  assert.match(cartBoot, /if \(cart\.ids\.length\)[\s\S]*?await loadAuthoritativeCatalog\(\)/);
  assert.match(cartRender, /if \(!cart\.ids\.length\)[\s\S]*?Todavía no agregaste artículos/);
  assert.match(cartRender, /products\.length !== cart\.ids\.length[\s\S]*?No se pudieron cargar todos tus artículos/);
});

test('catalog controller gates requests before loading and excludes cart, checkout, order, and admin', () => {
  const boot = sourceBetween(catalogController, 'async function boot()', 'function cleanPath');
  const routeGate = sourceBetween(catalogController, 'function isCatalogRoute', 'async function fetchCatalog');

  assert.ok(boot.indexOf('if (!isCatalogRoute(path)) return;') < boot.indexOf('await fetchCatalog(requestedSlug)'));
  assert.match(routeGate, /path === '\/'/);
  assert.match(routeGate, /path === '\/index\.html'/);
  assert.match(routeGate, /path\.startsWith\('\/producto\/'\)/);
  for (const excluded of ['/carrito', '/checkout', '/pedido/', '/admin']) {
    assert.equal(routeGate.includes(excluded), false, `${excluded} must not be a catalog-controller route`);
  }
  assert.match(catalogController, /return window\.loadAuthoritativeCatalog\(requestedSlug\)/);
});

test('checkout paints its route shell early, boots at DOM readiness, and has an empty fast path', () => {
  const render = sourceBetween(checkout, 'async function renderCheckoutPage()', 'function completeCheckoutRoute');
  const synchronized = render.indexOf('await window.__staticCartReady');
  const recovery = render.indexOf('window.__checkoutRecovery');
  const empty = render.indexOf('if (!cart.ids.length)');
  const catalog = render.indexOf('await window.loadAuthoritativeCatalog()');

  assert.match(homepage, /classList\.add\('checkout-route-pending'\)/);
  assert.match(homepage, /data-route-loading="checkout"[\s\S]*?FINALIZAR COMPRA[\s\S]*?Cargando tu compra…/);
  assert.match(checkout, /document\.addEventListener\('DOMContentLoaded', bootCheckoutRoutes, \{ once: true \}\)/);
  assert.doesNotMatch(checkout, /addEventListener\(\s*['"]load['"]/);
  assert.ok(synchronized >= 0 && synchronized < recovery);
  assert.ok(recovery < empty && empty < catalog);
  assert.match(render, /if \(!window\.__staticCartSynchronized\)/);
  assert.match(render, /if \(!cart\.ids\.length\)[\s\S]*?Tu carrito está vacío[\s\S]*?completeCheckoutRoute\(\)/);
  assert.match(render, /products\.length !== cart\.ids\.length[\s\S]*?No se pudieron cargar todos tus artículos/);
});

test('product pending, discovery batching, and exact history restoration hooks remain present', () => {
  assert.match(homepage, /classList\.add\('product-route-pending'\)/);
  assert.match(catalogController, /const INITIAL_RENDER_COUNT = 48/);
  assert.match(catalogController, /const RENDER_BATCH_SIZE = 48/);
  assert.match(catalogController, /restoreCatalogState\(savedState/);
  assert.match(catalogController, /restoreCatalogScroll/);
  assert.match(catalogController, /installCatalogHistoryTracking/);
});
