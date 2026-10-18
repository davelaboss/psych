import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('js/site.js', 'utf8');
const unifiedController = readFileSync('js/volume2-storefront.js', 'utf8');
const styles = readFileSync('css/product-detail-discovery.css', 'utf8');

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return source.slice(start, end).trim();
}

const discoverySource = extractFunction('buildProductDiscovery', 'renderProductSequenceLink');
const buildProductDiscovery = Function(
  `${discoverySource}; return buildProductDiscovery;`
)();

const suppressionSource = extractFunction(
  'shouldSuppressProductArrowNavigation',
  'setupProductDiscoveryKeyboard'
);
const shouldSuppressProductArrowNavigation = Function(
  `${suppressionSource}; return shouldSuppressProductArrowNavigation;`
)();

const keyboardSource = extractFunction('setupProductDiscoveryKeyboard', 'renderProductDetail');

const cardSource = extractFunction('renderRelatedProductCard', 'shouldSuppressProductArrowNavigation');
const renderRelatedProductCard = Function(
  'escapeHtml',
  'stripLeadingSlash',
  'formatPYG',
  'window',
  `${cardSource}; return renderRelatedProductCard;`
)(
  value => String(value),
  value => String(value).replace(/^\/+/, ''),
  value => `Gs. ${Number(value).toLocaleString('es-PY')}`,
  { imageDelivery: { resolve: value => '/' + value.replace(/^\/+/, ''), original: value => '/' + value.replace(/^\/+/, '') } }
);

const product = (itemNumber, overrides = {}) => ({
  id: `product-${itemNumber}`,
  slug: `product-${itemNumber}`,
  itemNumber,
  title: `Product ${itemNumber}`,
  category: 'Hogar',
  status: 'AVAILABLE',
  images: [`images/product-${itemNumber}.jpg`],
  askingPricePYG: itemNumber * 10_000,
  ...overrides,
});

const catalog = [
  product(1),
  product(2, { status: 'SOLD' }),
  product(3, { status: 'PICKED_UP' }),
  product(4),
  product(5, { status: 'UNLISTED' }),
  product(6, { status: 'NEEDS_REVIEW' }),
  product(7, { category: 'Cocina' }),
  product(8),
  product(9, { category: 'Cocina' }),
];

const ids = products => products.map(candidate => candidate.itemNumber);

test('available neighbors use nearest numeric available products and skip sold states', () => {
  const result = buildProductDiscovery(catalog, catalog[3]);
  assert.equal(result.previous.itemNumber, 1);
  assert.equal(result.next.itemNumber, 7);
});

test('sold current product still points to surrounding available products', () => {
  const result = buildProductDiscovery(catalog, catalog[1]);
  assert.equal(result.previous.itemNumber, 1);
  assert.equal(result.next.itemNumber, 4);
});

test('first and last available products do not wrap navigation', () => {
  const first = buildProductDiscovery(catalog, catalog[0]);
  const last = buildProductDiscovery(catalog, catalog[8]);
  assert.equal(first.previous, null);
  assert.equal(first.next.itemNumber, 4);
  assert.equal(last.previous.itemNumber, 8);
  assert.equal(last.next, null);
});

test('recommendations prioritize same category, wrap stably, then fill from other categories', () => {
  const result = buildProductDiscovery(catalog, catalog[3]);
  assert.deepEqual(ids(result.recommendations), [8, 1, 7, 9]);
  assert.ok(result.recommendations.every(candidate => candidate.status === 'AVAILABLE'));
  assert.ok(result.recommendations.slice(0, 2).every(candidate => candidate.category === 'Hogar'));
});

test('recommendations are deterministic, unique, and never contain the current product', () => {
  const duplicated = [...catalog, catalog[7], catalog[6]];
  const first = buildProductDiscovery(duplicated, catalog[3]);
  const second = buildProductDiscovery(duplicated, catalog[3]);
  assert.deepEqual(ids(first.recommendations), ids(second.recommendations));
  assert.equal(new Set(first.recommendations.map(candidate => candidate.id)).size, first.recommendations.length);
  assert.ok(first.recommendations.every(candidate => candidate.id !== catalog[3].id));
});

test('sold current product receives only available recommendations', () => {
  const result = buildProductDiscovery(catalog, catalog[1]);
  assert.deepEqual(ids(result.recommendations), [4, 8, 1, 7, 9]);
  assert.ok(result.recommendations.every(candidate => candidate.status === 'AVAILABLE'));
});

test('recommendations default to at most twelve eligible products', () => {
  const expandedCatalog = Array.from({ length: 18 }, (_, index) => product(index + 1, {
    category: index % 3 === 0 ? 'Cocina' : 'Hogar',
  }));
  const result = buildProductDiscovery(expandedCatalog, expandedCatalog[4]);
  assert.equal(result.recommendations.length, 12);
  assert.equal(new Set(result.recommendations.map(candidate => candidate.id)).size, 12);
  assert.ok(result.recommendations.every(candidate => candidate.status === 'AVAILABLE'));
  assert.ok(result.recommendations.every(candidate => candidate.id !== expandedCatalog[4].id));
});

test('hidden statuses cannot appear as neighbors or recommendations', () => {
  const result = buildProductDiscovery(catalog, catalog[3], 20);
  const visibleIds = [result.previous, result.next, ...result.recommendations]
    .filter(Boolean)
    .map(candidate => candidate.itemNumber);
  assert.ok(!visibleIds.includes(5));
  assert.ok(!visibleIds.includes(6));
});

test('arrow-key handler navigates left and right to the resolved available destinations', () => {
  let handler;
  const destinations = [];
  const fakeDocument = {
    addEventListener(type, callback) {
      assert.equal(type, 'keydown');
      handler = callback;
    },
    removeEventListener() {},
  };
  const fakeWindow = {
    location: { assign: destination => destinations.push(destination) },
  };
  const setupProductDiscoveryKeyboard = Function(
    'window',
    'document',
    'shouldSuppressProductArrowNavigation',
    `${keyboardSource}; return setupProductDiscoveryKeyboard;`
  )(fakeWindow, fakeDocument, () => false);

  setupProductDiscoveryKeyboard({ previous: product(1), next: product(4) });
  const event = key => ({ key, preventDefault() {}, target: {} });
  handler(event('ArrowLeft'));
  handler(event('ArrowRight'));
  assert.deepEqual(destinations, ['/producto/product-1', '/producto/product-4']);
});

test('authoritative rerender replaces the discovery key listener instead of duplicating it', () => {
  const listeners = new Set();
  const destinations = [];
  const fakeDocument = {
    addEventListener(type, callback) {
      assert.equal(type, 'keydown');
      listeners.add(callback);
    },
    removeEventListener(type, callback) {
      assert.equal(type, 'keydown');
      listeners.delete(callback);
    },
  };
  const fakeWindow = {
    location: { assign: destination => destinations.push(destination) },
  };
  const setupProductDiscoveryKeyboard = Function(
    'window',
    'document',
    'shouldSuppressProductArrowNavigation',
    `${keyboardSource}; return setupProductDiscoveryKeyboard;`
  )(fakeWindow, fakeDocument, () => false);

  setupProductDiscoveryKeyboard({ previous: product(1), next: product(4) });
  setupProductDiscoveryKeyboard({ previous: product(4), next: product(8) });

  assert.equal(listeners.size, 1);
  const event = { key: 'ArrowRight', preventDefault() {}, target: {} };
  for (const listener of listeners) listener(event);
  assert.deepEqual(destinations, ['/producto/product-8']);
});

test('arrow navigation is suppressed for gallery, lightbox, form, editable, and control contexts', () => {
  const root = activeSelector => ({
    querySelector(selector) {
      return activeSelector && selector.includes(activeSelector) ? {} : null;
    },
  });
  const target = (matchedSelector = '', overrides = {}) => ({
    isContentEditable: false,
    closest(selector) {
      return matchedSelector && selector.includes(matchedSelector) ? {} : null;
    },
    ...overrides,
  });
  const event = targetValue => ({
    target: targetValue,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  });

  for (const selector of [
    '.product-gallery',
    '[data-photo-index]',
    'input',
    'textarea',
    'select',
    'button',
    'a[href]',
    '[role="link"]',
    '[role="slider"]',
    '[role="combobox"]',
  ]) {
    assert.equal(shouldSuppressProductArrowNavigation(event(target(selector)), root()), true, selector);
  }
  assert.equal(
    shouldSuppressProductArrowNavigation(event(target('', { isContentEditable: true })), root()),
    true
  );
  assert.equal(shouldSuppressProductArrowNavigation(event(target()), root('.catalog-lightbox')), true);
  assert.equal(shouldSuppressProductArrowNavigation(event(target()), root()), false);
});

test('related card is one detail link containing only image, item, title, and price content', () => {
  const html = renderRelatedProductCard(product(7, {
    category: 'Secret category',
    description: 'Secret description',
    condition: 'Secret condition',
    knownDefects: 'Secret defect',
    pickupWindowStart: 'Secret pickup',
  }));
  assert.equal((html.match(/<a\b/g) || []).length, 1);
  assert.match(html, /href="\/producto\/product-7"/);
  assert.match(html, /<img\b/);
  assert.match(html, /Item 007/);
  assert.match(html, /<h3>Product 7<\/h3>/);
  assert.match(html, /related-product-price/);
  assert.doesNotMatch(html, /Secret category|Secret description|Secret condition|Secret defect|Secret pickup/);
  assert.doesNotMatch(html, /Agregar al carrito|data-cart|DISPONIBLE|RETIRO|VENDIDO/i);
  assert.doesNotMatch(html, /<(?:button|input|select|textarea)\b/i);
});

test('responsive styles provide four desktop cards and a narrow scroll-snap row without page overflow', () => {
  assert.match(styles, /grid-auto-columns:\s*calc\(\(100% - 45px\) \/ 4\)/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /grid-auto-flow:\s*column/);
  assert.match(styles, /grid-auto-columns:\s*82vw/);
  assert.match(styles, /overflow-x:\s*auto/);
  assert.match(styles, /scroll-snap-type:\s*x mandatory/);
  assert.match(styles, /\.product-sequence-navigation\s+\.product-sequence-link\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(styles, /width:\s*100vw/);
});

test('first render reserves the final two-slot navigation geometry without clipping text', () => {
  assert.match(source, /product-sequence-navigation\$\{discoveryCatalog\.length \? '' : ' is-pending'\}/);
  assert.match(source, /product-sequence-slot previous/);
  assert.match(source, /product-sequence-slot next/);
  assert.match(source, /product-sequence-divider/);
  assert.match(styles, /\.product-sequence-navigation\s*\{[^}]*min-height:\s*94px/s);
  assert.match(styles, /\.product-sequence-slot\s*\{[^}]*min-height:\s*72px/s);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.product-sequence-navigation\s*\{[^}]*min-height:\s*98px/s);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.product-sequence-slot\s*\{[^}]*min-height:\s*78px/s);
  assert.match(styles, /\.product-sequence-link > strong\s*\{[^}]*line-height:\s*1\.3/s);
  assert.match(styles, /\.product-sequence-link > span\s*\{[^}]*line-height:\s*1\.4/s);
  assert.doesNotMatch(styles, /\.product-sequence-navigation\s*\{[^}]*\n\s*height:\s*(?:94|98)px/s);
  assert.doesNotMatch(styles, /\.product-sequence-slot\s*\{[^}]*\n\s*height:\s*(?:72|78)px/s);
});

test('related carousel has accessible paging controls and a catalog escape hatch', () => {
  assert.match(source, /data-related-previous aria-label="Recomendaciones anteriores"/);
  assert.match(source, /data-related-next aria-label="Más recomendaciones"/);
  assert.match(source, /track\.scrollBy\(\{/);
  assert.match(source, /left:\s*direction \* pageWidth/);
  assert.match(source, /previous\.disabled = track\.scrollLeft <= 2/);
  assert.match(source, /next\.disabled = track\.scrollLeft >= maxScroll - 2/);
  assert.match(source, /currentIndex = nearestCardIndex\(\)/);
  assert.match(source, /track\.scrollLeft \+ cardLeft - trackLeft/);
  assert.match(source, /removeEventListener\('resize', window\.__relatedProductsResizeHandler\)/);
  assert.match(source, /Ver más productos →/);
  assert.match(source, /href="\/#articulos"/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.related-products-controls\s*\{[^}]*display:\s*none/s);
});

test('detail discovery waits for and consumes the authoritative catalog state', () => {
  assert.match(source, /Array\.isArray\(window\.__catalogProducts\)/);
  assert.match(source, /discoveryCatalog\.length/);
  assert.match(source, /setupProductDiscoveryKeyboard\(discoveryCatalog\.length \? discovery : null\)/);
});

test('an embedded product miss stays pending for authoritative route resolution', () => {
  const bootSource = extractFunction('bootStaticStorefront', 'getEmbeddedProductBySlug');
  const missStart = bootSource.indexOf('if (!product)');
  const missEnd = bootSource.indexOf('renderProductDetail(product)', missStart);
  const embeddedMiss = bootSource.slice(missStart, missEnd);

  assert.notEqual(missStart, -1, 'embedded miss handling should exist');
  assert.notEqual(missEnd, -1, 'embedded miss handling should precede static rendering');
  assert.match(embeddedMiss, /return;/);
  assert.doesNotMatch(embeddedMiss, /classList\.remove\(['"]product-route-pending['"]\)/);
  assert.doesNotMatch(embeddedMiss, /No se encontró el producto|console\.error/);

  assert.match(unifiedController, /const catalog = await fetchCatalog\(requestedSlug\)/);
  assert.match(unifiedController, /state\.products\.find\(\(item\) => item\.slug === requestedSlug\)/);
  assert.match(unifiedController, /else \{\s*renderUnavailableProductView\(\);\s*\}/);

  const unavailableStart = unifiedController.indexOf('function renderUnavailableProductView');
  const unavailableEnd = unifiedController.indexOf('function dedupe', unavailableStart);
  const unavailableView = unifiedController.slice(unavailableStart, unavailableEnd);
  assert.notEqual(unavailableStart, -1, 'unavailable view should exist');
  assert.notEqual(unavailableEnd, -1, 'unavailable view should be bounded');
  assert.match(unavailableView, /classList\.remove\(['"]product-route-pending['"]\)/);
});
