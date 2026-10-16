import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const controller = await readFile(new URL('../../../js/volume2-storefront.js', import.meta.url), 'utf8');
const homepage = await readFile(new URL('../../../index.html', import.meta.url), 'utf8');
const sourceComponent = await readFile(new URL('../../../source/components/storefront.tsx', import.meta.url), 'utf8');
const sourceStyles = await readFile(new URL('../../../source/app/globals.css', import.meta.url), 'utf8');
const deployedStyles = await readFile(new URL('../../../css/site.css', import.meta.url), 'utf8');

const instrumentedController = controller.replace(
  /\}\)\(\);\s*$/,
  'globalThis.__discovery = { normalize, filterProducts, sortProducts, INITIAL_RENDER_COUNT, RENDER_BATCH_SIZE };\n})();',
);
const context = {
  console,
  document: { readyState: 'loading', addEventListener() {} },
  window: {},
};
runInNewContext(instrumentedController, context);
const discovery = context.__discovery;

function product(itemNumber, overrides = {}) {
  return {
    id: `product-${itemNumber}`,
    itemNumber,
    slug: `product-${itemNumber}`,
    title: `Producto ${itemNumber}`,
    category: 'Hogar',
    description: '',
    condition: 'Buen estado',
    conditionNotes: '',
    askingPricePYG: 100000,
    saleMode: 'IMMEDIATE',
    status: 'AVAILABLE',
    dateListed: '2026-08-01',
    ...overrides,
  };
}

function criteria(overrides = {}) {
  return {
    query: '',
    category: '',
    availability: 'ALL',
    condition: 'ALL',
    maxPrice: 0,
    showSold: false,
    ...overrides,
  };
}

test('mobile discovery order puts search, categories, availability, count, and catalog first', () => {
  const tokens = [
    '¿Qué estás buscando?',
    'O elegí una categoría',
    'class="availability-choices"',
    'class="catalog-toolbar"',
    'class="product-grid"',
    'class="how-it-works"',
    'class="faq"',
    'class="floating-whatsapp"',
    'class="site-footer"',
  ];
  const positions = tokens.map((token) => homepage.indexOf(token));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(homepage, /Ej\.: mesa, licuadora o Item 125/);
});

test('core category and availability controls wrap without sideways-only discovery', () => {
  for (const label of ['Todas', 'Cocina', 'Hogar', 'Oficina', 'Electrodomésticos', 'Jardín', 'Muebles', 'Herramientas', 'Más categorías']) {
    assert.match(homepage, new RegExp(label));
  }
  assert.match(controller, /new Set\(state\.products/);
  assert.match(controller, /moreCategories = categories\.filter/);
  assert.match(controller, /data-category-button/);
  assert.match(controller, /data-availability="ALL"[\s\S]*data-availability="IMMEDIATE"[\s\S]*data-availability="DELAYED"/);
  assert.match(sourceStyles, /\.catalog-discovery \.category-row \{[^}]*flex-wrap: wrap;[^}]*overflow: visible;/);
  assert.match(deployedStyles, /\.catalog-discovery \.category-row\{[^}]*flex-wrap:wrap[^}]*overflow:visible/);
});

test('search and filters evaluate the complete authoritative collection, including unrendered items', () => {
  const products = Array.from({ length: 120 }, (_, index) => product(index + 1, {
    title: index === 119 ? 'Licuadora especial' : `Producto ${index + 1}`,
  }));
  const keyword = discovery.filterProducts(products, criteria({ query: discovery.normalize('licuadora') }));
  const item = discovery.filterProducts(products, criteria({ query: discovery.normalize('Item 120') }));
  assert.deepEqual(keyword.map((entry) => entry.itemNumber), [120]);
  assert.deepEqual(item.map((entry) => entry.itemNumber), [120]);
  assert.equal(discovery.INITIAL_RENDER_COUNT, 48);
});

test('sold products are hidden by default and remain opt-in and non-purchasable', () => {
  const products = [product(1), product(2, { status: 'SOLD' }), product(3, { status: 'PICKED_UP' })];
  assert.deepEqual(discovery.filterProducts(products, criteria()).map((entry) => entry.itemNumber), [1]);
  assert.deepEqual(discovery.filterProducts(products, criteria({ showSold: true })).map((entry) => entry.itemNumber), [1, 2, 3]);
  assert.match(controller, /Ver artículos vendidos/);
  assert.match(controller, /data-cart-action \$\{!available \? 'disabled' : ''\}/);
  assert.match(controller, /if \(product\.status !== 'AVAILABLE'\) return;/);
});

test('availability and newest sorting use sale mode and dateListed', () => {
  const products = [
    product(10, { saleMode: 'IMMEDIATE', dateListed: '2026-09-01' }),
    product(99, { saleMode: 'DELAYED', dateListed: '2026-08-01' }),
    product(2, { saleMode: 'IMMEDIATE', dateListed: '2026-10-01' }),
  ];
  assert.deepEqual(discovery.filterProducts(products, criteria({ availability: 'IMMEDIATE' })).map((entry) => entry.itemNumber), [10, 2]);
  assert.deepEqual(discovery.filterProducts(products, criteria({ availability: 'DELAYED' })).map((entry) => entry.itemNumber), [99]);
  discovery.sortProducts(products, 'newest');
  assert.deepEqual(products.map((entry) => entry.itemNumber), [2, 10, 99]);
});

test('progressive loading is automatic, append-only, and has an accessible fallback', () => {
  assert.equal(discovery.RENDER_BATCH_SIZE, 48);
  assert.match(controller, /state\.filtered\.slice\(state\.renderedCount, end\)/);
  assert.match(controller, /grid\.appendChild\(fragment\)/);
  assert.match(controller, /new IntersectionObserver/);
  assert.match(controller, /rootMargin: '900px 0px'/);
  assert.match(controller, /Cargar más artículos/);
  assert.doesNotMatch(controller, /Mostrar más/);
  assert.match(controller, /document\.documentElement\.scrollHeight < targetScroll/);
  assert.match(controller, /window\.scrollTo\(\{ top: targetScroll, left: 0, behavior: 'auto' \}\)/);
});

test('advanced controls are secondary, counted, and reset only appears while filtered', () => {
  assert.match(controller, /<summary>Más filtros <span data-filter-count hidden><\/span><\/summary>/);
  assert.match(controller, /condition\?\.value !== 'ALL'/);
  assert.match(controller, /if \(c\.reset\) c\.reset\.hidden = !hasAnyFilter/);
  assert.match(controller, /Restablecer filtros/);
  assert.match(controller, /Orden del catálogo/);
  assert.doesNotMatch(controller, /Recomendados/);
  assert.doesNotMatch(controller, /Rebajados/);
});

test('homepage has no duplicate merchandising or delayed-pickup shelf', () => {
  const renderedSources = `${homepage}\n${sourceComponent}\n${controller}`;
  assert.doesNotMatch(renderedSources, /Selección destacada|Recién agregados|Rebajados recientemente/);
  assert.doesNotMatch(renderedSources, /data-delayed-shelf|buildDelayedShelf/);
  assert.doesNotMatch(sourceComponent, /<Shelf\b|function Shelf\b/);
});

test('card navigation, cart behavior, Sale Pulse context, and two-column mobile grid remain intact', () => {
  assert.match(controller, /data-product-card-link/);
  assert.match(controller, /window\.location\.assign\(`\/producto\//);
  assert.match(controller, /window\.addStaticCartItem/);
  for (const eventType of ['SEARCH', 'CATEGORY_SELECT', 'FILTER_APPLY']) {
    assert.match(controller, new RegExp(`salePulseTrack\\?\\.\\('${eventType}'`));
  }
  assert.match(sourceStyles, /@media \(max-width: 940px\)[\s\S]*\.product-grid \{ grid-template-columns: repeat\(2/);
  assert.doesNotMatch(sourceStyles, /\.catalog-discovery \.category-row[^}]*overflow-x:\s*auto/);
});
