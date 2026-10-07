import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  loadPublicCatalog,
  projectPublicCatalog,
} from './commerce.mjs';
import { isMarketingEligible } from './marketing-email.mjs';

const product = (id, overrides = {}) => ({
  id,
  slug: `product-${id}`,
  title: `Product ${id}`,
  itemNumber: Number(String(id).replace(/\D/g, '')) || 1,
  category: 'Test',
  status: 'SOLD',
  quantityRemaining: 0,
  ...overrides,
});

const row = (productId, batchStatus, overrides = {}) => ({
  order_id: `order-${productId}`,
  product_id: productId,
  quantity: 1,
  fulfillment_batch_id: `batch-${productId}`,
  batch_status: batchStatus,
  merged_into_batch_id: null,
  ...overrides,
});

const ids = result => result.products.map(candidate => candidate.id);

test('available unsold products always remain public', () => {
  const available = product('1', { status: 'AVAILABLE', quantityRemaining: 1 });
  const result = projectPublicCatalog([available], [row('1', 'DELIVERED')]);
  assert.deepEqual(ids(result), ['1']);
});

for (const status of ['OPEN', 'PREPARED', 'LEGACY_FROZEN']) {
  test(`sold product in ${status} remains public as sold`, () => {
    const result = projectPublicCatalog([product('2')], [row('2', status)]);
    assert.deepEqual(ids(result), ['2']);
  });
}

test('sold product hides only when every active membership is delivered', () => {
  const sold = product('3');
  const mixed = projectPublicCatalog([sold], [
    row('3', 'DELIVERED', { order_id: 'order-a' }),
    row('3', 'OPEN', { order_id: 'order-b', fulfillment_batch_id: 'batch-b' }),
  ]);
  assert.deepEqual(ids(mixed), ['3']);

  const delivered = projectPublicCatalog([sold], [
    row('3', 'DELIVERED', { order_id: 'order-a' }),
    row('3', 'DELIVERED', { order_id: 'order-b', fulfillment_batch_id: 'batch-b' }),
  ]);
  assert.deepEqual(ids(delivered), []);
});

test('Virginia-style separation hides delivered originals but keeps 062 and 154 public', () => {
  const products = [product('original-a'), product('original-b'), product('062'), product('154')];
  const rows = [
    row('original-a', 'DELIVERED'),
    row('original-b', 'DELIVERED'),
    row('062', 'LEGACY_FROZEN', { fulfillment_batch_id: 'separated-062' }),
    row('154', 'PREPARED', { fulfillment_batch_id: 'separated-154' }),
  ];
  assert.deepEqual(ids(projectPublicCatalog(products, rows)), ['062', '154']);
});

test('missing membership fails safe and remains public', () => {
  const result = projectPublicCatalog([product('4')], [row('4', 'DELIVERED', {
    fulfillment_batch_id: null,
    batch_status: null,
  })]);
  assert.deepEqual(ids(result), ['4']);
});

test('merged source is ignored and the current target membership controls delivery', () => {
  const fromMergedSource = projectPublicCatalog([product('5')], [row('5', 'DELIVERED', {
    merged_into_batch_id: 'target-batch',
  })]);
  assert.deepEqual(ids(fromMergedSource), ['5']);

  const onDeliveredTarget = projectPublicCatalog([product('5')], [row('5', 'DELIVERED', {
    fulfillment_batch_id: 'target-batch',
  })]);
  assert.deepEqual(ids(onDeliveredTarget), []);
});

test('delayed sold item remains visible until its own batch is delivered', () => {
  const delayed = product('6', { saleMode: 'DELAYED' });
  assert.deepEqual(ids(projectPublicCatalog([delayed], [row('6', 'PREPARED')])), ['6']);
  assert.deepEqual(ids(projectPublicCatalog([delayed], [row('6', 'DELIVERED')])), []);
});

test('quantity greater than one fails safe because per-unit delivery is ambiguous', () => {
  const result = projectPublicCatalog([product('7')], [row('7', 'DELIVERED', { quantity: 2 })]);
  assert.deepEqual(ids(result), ['7']);
});

test('UNLISTED and NEEDS_REVIEW remain excluded after authoritative overrides', () => {
  const result = projectPublicCatalog([
    product('8', { status: 'UNLISTED' }),
    product('9', { status: 'NEEDS_REVIEW' }),
    product('10', { status: 'SOLD' }),
  ], []);
  assert.deepEqual(ids(result), ['10']);
});

test('known delivered slug receives a minimal marker while unknown slug does not', () => {
  const delivered = product('11', { askingPricePYG: 999999, images: ['secret.jpg'] });
  const known = projectPublicCatalog([delivered], [row('11', 'DELIVERED')], delivered.slug);
  assert.deepEqual(known.products, []);
  assert.deepEqual(known.deliveredProduct, {
    id: '11',
    slug: 'product-11',
    title: 'Product 11',
    itemNumber: 11,
    category: 'Test',
  });
  assert.equal(Object.hasOwn(known.deliveredProduct, 'askingPricePYG'), false);
  assert.equal(Object.hasOwn(known.deliveredProduct, 'images'), false);

  const unknown = projectPublicCatalog([delivered], [row('11', 'DELIVERED')], 'unknown');
  assert.equal(unknown.deliveredProduct, null);
});

test('public loading is read-only and does not mutate the authoritative catalog', async () => {
  const authoritative = [product('12')];
  const calls = [];
  const result = await loadPublicCatalog('https://example.com', {}, {
    loadCatalog: async origin => {
      calls.push(['catalog', origin]);
      return authoritative;
    },
    readFulfillmentDeliveryRows: async () => {
      calls.push(['delivery']);
      return [row('12', 'DELIVERED')];
    },
  });
  assert.deepEqual(result.products, []);
  assert.deepEqual(authoritative.map(candidate => candidate.id), ['12']);
  assert.deepEqual(calls, [
    ['catalog', 'https://example.com'],
    ['delivery'],
  ]);
});

test('internal, stale-cart, and marketing consumers remain isolated and safe', async () => {
  const [adminSource, cartSource, orderSource, marketingSource, endpointSource] = await Promise.all([
    readFile(new URL('../admin-legacy-inventory.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../cart-reservation.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../create-order.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./marketing-email-service.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../volume2-catalog.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(adminSource, /loadCatalog/);
  assert.doesNotMatch(adminSource, /loadPublicCatalog/);
  assert.match(cartSource, /loadCatalog/);
  assert.match(cartSource, /product\.status !== 'AVAILABLE'/);
  assert.match(orderSource, /loadCatalog/);
  assert.match(orderSource, /product\.status !== 'AVAILABLE'/);
  assert.match(marketingSource, /loadCatalog/);
  assert.match(endpointSource, /loadPublicCatalog/);
  assert.doesNotMatch(endpointSource, /\bloadCatalog\b/);
  assert.equal(isMarketingEligible(product('13')), false);
});

test('fulfillment delivery projection query is read-only', async () => {
  const source = await readFile(new URL('./inventory-database.mjs', import.meta.url), 'utf8');
  const reader = source.match(
    /export async function readFulfillmentDeliveryRows\(\)[\s\S]*?(?=\r?\n\r?\nexport async function updateProductCapacity)/
  )?.[0] || '';
  assert.match(reader, /SELECT/);
  assert.match(reader, /fulfillment_batch_items/);
  assert.match(reader, /fulfillment_batches/);
  assert.doesNotMatch(reader, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);
});

test('direct URL views distinguish delivered from genuinely unknown products', async () => {
  const source = await readFile(
    new URL('../../../js/volume2-storefront.js', import.meta.url),
    'utf8'
  );
  const deliveredView = source.match(
    /function renderDeliveredProductView\(product\)[\s\S]*?(?=\r?\n\r?\n  function renderUnavailableProductView)/
  )?.[0] || '';
  const unknownView = source.match(
    /function renderUnavailableProductView\(\)[\s\S]*?(?=\r?\n\r?\n  function dedupe)/
  )?.[0] || '';

  assert.match(deliveredView, /Este artículo ya fue vendido y entregado\./);
  assert.match(deliveredView, /Te invitamos a ver otros artículos disponibles\./);
  assert.match(deliveredView, /Ver artículos disponibles/);
  assert.doesNotMatch(deliveredView, /data-cart|askingPrice|formatMoney|<button|<form/i);
  assert.match(unknownView, /No encontramos ese artículo\./);
  assert.match(unknownView, /Volver al catálogo/);
});
