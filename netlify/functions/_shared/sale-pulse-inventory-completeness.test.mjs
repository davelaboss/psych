import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadCatalog } from './commerce.mjs';
import { buildSalePulseSnapshot, completeMarketingInventory } from './sale-pulse.mjs';
import { createAdminSalePulseHandler, loadSalePulseSnapshot } from '../admin-sale-pulse.mjs';

const product = (id, overrides = {}) => ({
  id, itemNumber: Number(id.replace('product-', '')), title: id,
  status: 'AVAILABLE', quantityRemaining: 1, ...overrides,
});
const row = (overrides = {}) => ({
  product_id: 'product-1', capacity: 3, committed_quantity: 0,
  cart_held_quantity: 1, order_held_quantity: 0,
  next_release_at: null, purchasable_quantity: 2, ...overrides,
});
const packet = (products, inventory) => buildSalePulseSnapshot({
  products, purchasableInventory: completeMarketingInventory(products, inventory),
}).marketingPacket;

for (const remaining of [1, 3]) {
  test(`successful empty operational read markets ${remaining} untouched catalog units`, async () => {
    let reads = 0;
    const snapshot = await loadSalePulseSnapshot('https://example.com', {
      loadProducts: async () => [product('product-1', { quantityRemaining: remaining, quantityTotal: 10 })],
      query: async (sql) => {
        if (sql.includes('FROM operational_inventory inventory')) reads += 1;
        return { rows: [] };
      },
    });
    assert.equal(reads, 1);
    const result = snapshot.marketingPacket.marketableProducts[0];
    assert.equal(result.marketabilityStatus, 'MARKETABLE');
    assert.equal(result.quantityRemaining, remaining);
    assert.equal(result.purchasableQuantity, remaining);
    assert.equal(result.cartHeldQuantity, 0);
    assert.equal(result.orderHeldQuantity, 0);
    assert.equal(result.nextReleaseAt, null);
    assert.equal(snapshot.marketingPacket.marketabilitySummary.purchasableUnits, remaining);
  });
}

for (const [label, overrides, status, units] of [
  ['partial CART', {}, 'MARKETABLE', 2],
  ['final CART', { capacity: 1, purchasable_quantity: 0 }, 'TEMPORARILY_RESERVED', 0],
  ['final ORDER', { capacity: 1, cart_held_quantity: 0, order_held_quantity: 1, purchasable_quantity: 0,
    next_release_at: '2026-10-19T00:00:00Z' }, 'PENDING_PAYMENT_OR_CONFIRMATION', 0],
  ['protected ORDER', { capacity: 1, cart_held_quantity: 0, order_held_quantity: 1,
    purchasable_quantity: 0 }, 'PENDING_PAYMENT_OR_CONFIRMATION', 0],
  ['mixed CART and ORDER', { order_held_quantity: 2, purchasable_quantity: 0 }, 'PENDING_PAYMENT_OR_CONFIRMATION', 0],
  ['committed', { committed_quantity: 3, cart_held_quantity: 0, purchasable_quantity: 0 }, 'SOLD', 0],
]) {
  test(`completion preserves authoritative operational ${label} row`, () => {
    const actual = Object.freeze(row(overrides));
    const inventory = new Map([['product-1', actual], ['other-product', Object.freeze(row())]]);
    const before = structuredClone(inventory);
    const products = [product('product-1', { quantityRemaining: 3 }), product('product-2')];
    const completed = completeMarketingInventory(products, inventory);
    assert.notEqual(completed, inventory);
    assert.equal(completed.get('product-1'), actual);
    assert.equal(completed.get('other-product'), inventory.get('other-product'));
    assert.deepEqual(inventory, before);
    assert.equal(inventory.has('product-2'), false);
    const result = buildSalePulseSnapshot({ products, purchasableInventory: completed }).marketingPacket;
    assert.equal(result.products[0].marketabilityStatus, status);
    assert.equal(result.products[0].purchasableQuantity, units);
    assert.equal(result.products[1].marketabilityStatus, 'MARKETABLE');
  });
}

for (const status of ['SOLD', 'PICKED_UP', 'UNLISTED', 'NEEDS_REVIEW', 'RESERVED']) {
  test(`missing operational row never markets catalog status ${status}`, () => {
    const products = [product('product-1', { status })];
    const completed = completeMarketingInventory(products, new Map());
    assert.equal(completed.size, 0);
    const result = packet(products, new Map());
    assert.deepEqual(result.marketableProducts, []);
    assert.ok(Object.values(result.signalLists).every((items) => items.length === 0));
    if (['UNLISTED', 'NEEDS_REVIEW'].includes(status)) assert.deepEqual(result.products, []);
    else assert.notEqual(result.products[0].marketabilityStatus, 'MARKETABLE');
  });
}

for (const remaining of [undefined, null, '', '3', 'invalid', -1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true, {}, []]) {
  test(`unsafe catalog quantity ${String(remaining)} receives no synthetic stock`, () => {
    const products = [product('product-1', { quantityRemaining: remaining, quantityTotal: 3 })];
    assert.equal(completeMarketingInventory(products, new Map()).size, 0);
    const result = packet(products, new Map());
    assert.deepEqual(result.marketableProducts, []);
    assert.equal(result.products[0].purchasableQuantity, 0);
  });
}

test('absent operational read cannot authorize fallback or direct snapshot marketing', () => {
  for (const unread of [undefined, null, {}, []]) {
    assert.throws(() => completeMarketingInventory([product('product-1')], unread), /successful inventory read/);
  }
  const result = buildSalePulseSnapshot({ products: [product('product-1')] }).marketingPacket;
  assert.equal(result.products[0].marketabilityReason, 'INVENTORY_NOT_VERIFIED');
  assert.equal(result.products[0].purchasableQuantity, 0);
});

test('inventory query error rejects snapshot and returns an unsuccessful admin response', async () => {
  const loadSnapshot = () => loadSalePulseSnapshot('https://example.com', {
    loadProducts: async () => [product('product-1')],
    query: async (sql) => {
      if (sql.includes('FROM operational_inventory inventory')) throw new Error('inventory unavailable');
      return { rows: [] };
    },
  });
  await assert.rejects(loadSnapshot(), /inventory unavailable/);
  const handler = createAdminSalePulseHandler({ authorized: () => true, loadSnapshot });
  const response = await handler(new Request('https://example.com/api/admin/sale-pulse'));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, 'inventory unavailable');
  assert.equal(body.salePulse, undefined);
});

test('fallback uses current loadCatalog overrides and keeps public facts allowlisted', async () => {
  const products = await loadCatalog('https://example.com', {
    loadBaseCatalog: async () => [product('product-1', { quantityTotal: 10, quantityRemaining: 3 })],
    listProductOverrides: async () => [{ productId: 'product-1',
      images: ['/current-cover.webp', '/second.webp'],
      publicFields: { title: 'Current title', askingPricePYG: 189000, quantityRemaining: 1 },
    }],
    readCommittedInventory: async () => new Map(),
  });
  products[0].buyer = { name: 'PRIVATE-BUYER' };
  products[0].accessToken = 'PRIVATE-TOKEN';
  products[0].mainImage = '/stale-cover.jpg';
  const before = structuredClone(products);
  const result = packet(products, new Map()).marketableProducts[0];
  assert.equal(result.purchasableQuantity, products[0].quantityRemaining);
  assert.equal(result.purchasableQuantity, 1);
  assert.equal(result.title, 'Current title');
  assert.equal(result.askingPricePYG, 189000);
  assert.equal(result.mainImage, products[0].images[0]);
  assert.deepEqual(Object.keys(result).sort(), [
    'productId', 'itemNumber', 'title', 'views', 'cartAdds', 'slug', 'productUrl', 'category',
    'askingPricePYG', 'saleMode', 'mainImage', 'quantityRemaining', 'purchasableQuantity',
    'cartHeldQuantity', 'orderHeldQuantity', 'nextReleaseAt', 'marketabilityStatus', 'marketabilityReason', 'signals',
    'description', 'condition', 'conditionNotes', 'knownDefects', 'functionality', 'measurements',
    'saleStructure', 'notIncludedVisible', 'images', 'includedAccessories', 'logisticsNotes',
    'requiresVehicle', 'requiresLoadingHelp', 'depositPercent', 'pickupAvailableDate', 'pickupWindowStart', 'pickupWindowEnd',
    'finalPaymentWindowStart', 'finalPaymentWindowEnd',
  ].sort());
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-|buyer|accessToken/);
  assert.deepEqual(products, before);
});

test('untouched fallback products participate in all five lists while held products stay excluded', () => {
  const products = [product('product-1'), product('product-2'), product('product-3')];
  const generatedAt = Date.parse('2026-10-18T12:00:00Z');
  const snapshot = buildSalePulseSnapshot({
    generatedAt, trackingStartedAt: generatedAt - 48 * 3600000, products,
    purchasableInventory: completeMarketingInventory(products, new Map([['product-3', row({
      product_id: 'product-3', capacity: 1, purchasable_quantity: 0,
    })]])),
    events: [
      ['PRODUCT_VIEW', 'product-1'], ['ADD_TO_CART', 'product-1'],
      ['PRODUCT_VIEW', 'product-2'], ['PRODUCT_VIEW', 'product-3'], ['ADD_TO_CART', 'product-3'],
    ].map(([eventType, productId]) => ({ eventType, productId, occurredAt: generatedAt - 3600000 })),
  });
  const result = snapshot.marketingPacket;
  assert.equal(Object.keys(result.signalLists).length, 5);
  for (const items of Object.values(result.signalLists)) {
    assert.ok(items.length > 0);
    for (const id of items) {
      assert.notEqual(id, 'product-3');
      assert.equal(result.products.find((item) => item.productId === id).marketabilityStatus, 'MARKETABLE');
    }
  }
  assert.ok(result.signalLists.cartInterestWithoutSale.includes('product-1'));
  assert.ok(result.signalLists.viewedButNotAdded.includes('product-2'));
  assert.equal(snapshot.last24Hours.productViews, 3);
  assert.equal(snapshot.last24Hours.addToCart, 2);
});

test('real migration forbids reservations without inventory; Sale Pulse fallback never writes synthetic rows', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('../../database/migrations/20261001_operational_inventory.sql', import.meta.url), 'utf8'));
  const session = '11111111-1111-4111-8111-111111111111';
  await db.query('INSERT INTO cart_sessions(session_id) VALUES ($1)', [session]);
  await db.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot)
    VALUES ('test-order',$1,$2,0,'fixture','{}')`, [session, '22222222-2222-4222-8222-222222222222']);
  for (const phase of ['CART', 'ORDER', 'COMMITTED']) {
    await assert.rejects(db.query(`INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,order_id,expires_at)
      VALUES ('never-initialized',$1,1,$2,$3,clock_timestamp() + interval '1 hour')`,
    [session, phase, phase === 'CART' ? null : 'test-order']), (error) => {
      assert.equal(error.code, '23503');
      assert.equal(error.constraint, 'inventory_reservations_product_id_fkey');
      return true;
    });
  }
  await db.query("INSERT INTO operational_inventory(product_id,capacity) VALUES ('product-2',3)");
  await db.query(`INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,expires_at)
    VALUES ('product-2',$1,1,'CART',clock_timestamp() + interval '1 hour')`, [session]);
  const tables = ['operational_inventory', 'inventory_reservations', 'cart_sessions', 'checkout_attempts'];
  const state = () => Promise.all(tables.map(async (table) => (await db.query(`SELECT * FROM ${table}`)).rows));
  const before = await state();
  const queries = [];
  const snapshot = await loadSalePulseSnapshot('https://example.com', {
    loadProducts: async () => [product('product-1'), product('product-2', { quantityRemaining: 3 })],
    query: async (sql, params) => {
      queries.push(sql);
      assert.match(sql, /^\s*SELECT\b|^\s*DELETE FROM sale_analytics_events\b/);
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE)\b|DELETE FROM (?:operational_inventory|inventory_reservations)|FOR UPDATE/);
      return sql.includes('FROM operational_inventory inventory') ? db.query(sql, params) : { rows: [] };
    },
  });
  assert.deepEqual(snapshot.marketingPacket.marketableProducts.map((item) => item.purchasableQuantity), [1, 2]);
  assert.equal(queries.filter((sql) => /^\s*DELETE\b/.test(sql)).length, 1);
  assert.deepEqual(await state(), before);
  assert.equal((await db.query("SELECT * FROM operational_inventory WHERE product_id='product-1'")).rows.length, 0);
});
