import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { loadBaseCatalog, loadCatalog } from './commerce.mjs';
import { createAnalyticsEventHandler } from '../analytics-event.mjs';
import { createAdminSalePulseHandler, loadSalePulseSnapshot } from '../admin-sale-pulse.mjs';
import { readPurchasableInventory } from './inventory-database.mjs';
import { createCartReservationHandler } from '../cart-reservation.mjs';
import {
  buildSalePulseSnapshot,
  dedupeWindowFor,
  hashAnonymousSession,
  normalizeCampaignSource,
  recordAnalyticsEvent,
  validateAnalyticsEvent,
} from './sale-pulse.mjs';

const sessionId = '11111111-1111-4111-8111-111111111111';
const now = Date.parse('2026-10-14T15:00:00.000Z');
const hoursAgo = (hours) => new Date(now - hours * 3600000).toISOString();
const salePulseClient = await readFile(new URL('../../../js/sale-pulse.js', import.meta.url), 'utf8');

function product(number, overrides = {}) {
  return {
    id: `product-${number}`,
    itemNumber: number,
    title: `Producto ${number}`,
    status: 'AVAILABLE',
    quantityRemaining: 1,
    ...overrides,
  };
}

function inventoryRow(number, overrides = {}) {
  return {
    product_id: `product-${number}`, capacity: 1, committed_quantity: 0,
    purchasable_quantity: 1, cart_held_quantity: 0, order_held_quantity: 0,
    next_release_at: null, ...overrides,
  };
}

const availableInventory = (...numbers) => new Map(numbers.map((number) => [
  `product-${number}`, inventoryRow(number),
]));

function event(eventType, hours, overrides = {}) {
  return {
    eventType,
    occurredAt: hoursAgo(hours),
    sessionHash: 'a'.repeat(64),
    campaignSource: 'direct',
    ...overrides,
  };
}

function claimHandler({ claimLease, recordEvent }) {
  return createCartReservationHandler({
    claimLease,
    recordEvent,
    loadProducts: async () => [product(1)],
    salesOpen: () => true,
  });
}

function claimRequest(analytics) {
  const body = { action: 'claim', productId: 'product-1', quantity: 1 };
  if (analytics !== undefined) body.analytics = analytics;
  return new Request('https://example.com/api/cart/reservation', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `psych_cart_session=${sessionId}`,
    },
    body: JSON.stringify(body),
  });
}

async function storefrontSourceScenario({ stored, search = '' } = {}) {
  const values = new Map();
  if (stored !== undefined) values.set('psych-sale-pulse-source', stored);
  const events = [];
  const sessionStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const window = {
    location: { pathname: '/', search },
    addEventListener() {},
  };
  const document = { body: { dataset: {} } };
  const fetch = async (_url, options) => {
    events.push(JSON.parse(options.body));
    return { ok: true };
  };
  runInNewContext(salePulseClient, {
    Date,
    JSON,
    Number,
    Object,
    Promise,
    Set,
    String,
    URLSearchParams,
    document,
    fetch,
    sessionStorage,
    window,
  });
  await new Promise((resolve) => setImmediate(resolve));
  return {
    source: events[0]?.campaignSource,
    stored: values.get('psych-sale-pulse-source'),
  };
}

test('analytics migration is forward-only and creates the compact indexed schema', async () => {
  const sql = await readFile(new URL('../../database/migrations/20261014_sale_pulse_analytics.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE sale_analytics_events/);
  assert.match(sql, /anonymous_session_hash text/);
  assert.match(sql, /filter_context jsonb/);
  assert.match(sql, /sale_analytics_type_occurred_at/);
  assert.match(sql, /sale_analytics_product_occurred_at/);
  assert.doesNotMatch(sql, /ALTER TABLE (?:operational_inventory|checkout_attempts)/);
});

test('event validation accepts the six defined types only for trusted paths', () => {
  for (const eventType of ['CATALOG_VISIT', 'CATEGORY_SELECT', 'SEARCH', 'FILTER_APPLY', 'PRODUCT_VIEW']) {
    const payload = {
      eventType,
      ...(eventType === 'CATEGORY_SELECT' ? { category: 'Muebles' } : {}),
      ...(eventType === 'SEARCH' ? { searchTerm: 'mesa' } : {}),
      ...(eventType === 'FILTER_APPLY' ? { filters: { availability: 'IMMEDIATE' } } : {}),
      ...(eventType === 'PRODUCT_VIEW' ? { productId: 'product-1' } : {}),
    };
    assert.equal(validateAnalyticsEvent(payload).eventType, eventType);
  }
  assert.throws(() => validateAnalyticsEvent({ eventType: 'ADD_TO_CART', productId: 'product-1' }), /tipo de evento/i);
  assert.equal(validateAnalyticsEvent({ eventType: 'ADD_TO_CART', productId: 'product-1' },
    { allowAddToCart: true }).eventType, 'ADD_TO_CART');
  assert.throws(() => validateAnalyticsEvent({ eventType: 'MADE_UP' }), /tipo de evento/i);
});

test('malformed payloads and arbitrary fields are rejected', () => {
  for (const payload of [
    null,
    [],
    { eventType: 'PRODUCT_VIEW' },
    { eventType: 'SEARCH', searchTerm: '' },
    { eventType: 'FILTER_APPLY', filters: {} },
    { eventType: 'CATALOG_VISIT', surprise: 'data' },
    { eventType: 'PRODUCT_VIEW', productId: '<script>' },
    { eventType: 'CATALOG_VISIT', resultPosition: 4, resultCount: 3 },
  ]) assert.throws(() => validateAnalyticsEvent(payload));
});

test('search analytics never retain free text and controlled context is allowlisted', () => {
  assert.equal(validateAnalyticsEvent({ eventType: 'SEARCH', searchTerm: 'mesa' }).searchTerm, null);
  assert.equal(validateAnalyticsEvent({ eventType: 'SEARCH', searchTerm: 'cliente@example.com' }).searchTerm, null);
  assert.equal(validateAnalyticsEvent({ eventType: 'SEARCH', searchTerm: '+595 981 123 456' }).searchTerm, null);
  assert.equal(validateAnalyticsEvent({ eventType: 'CATEGORY_SELECT', category: 'Muebles' }).category, 'Muebles');
  assert.equal(validateAnalyticsEvent({ eventType: 'CATEGORY_SELECT', category: 'Juegos' }).category, 'Juegos');
  assert.throws(() => validateAnalyticsEvent({ eventType: 'CATEGORY_SELECT', category: 'Nombre de persona' }));
  assert.deepEqual(validateAnalyticsEvent({
    eventType: 'FILTER_APPLY', filters: { availability: 'IMMEDIATE', maxPrice: '500000' },
  }).filters, { availability: 'IMMEDIATE', maxPrice: '500000' });
  assert.deepEqual(validateAnalyticsEvent({
    eventType: 'FILTER_APPLY', filters: { showSold: 'true' },
  }).filters, { showSold: 'true' });
  assert.throws(() => validateAnalyticsEvent({
    eventType: 'FILTER_APPLY', filters: { availability: 'cliente@example.com' },
  }));
});

test('campaign source normalization is conservative', () => {
  assert.equal(normalizeCampaignSource('story'), 'story');
  assert.equal(normalizeCampaignSource('JW-GROUP'), 'jw-group');
  assert.equal(normalizeCampaignSource('facebook'), 'direct');
  assert.equal(normalizeCampaignSource(null), 'direct');
});

test('campaign source uses direct when neither a stored source nor tag exists', async () => {
  assert.deepEqual(await storefrontSourceScenario(), { source: 'direct', stored: 'direct' });
});

test('campaign source stores and uses a fresh explicit story tag', async () => {
  assert.deepEqual(await storefrontSourceScenario({ search: '?src=story' }), {
    source: 'story', stored: 'story',
  });
});

test('explicit story overrides a stored direct source', async () => {
  assert.deepEqual(await storefrontSourceScenario({ stored: 'direct', search: '?src=story' }), {
    source: 'story', stored: 'story',
  });
});

test('explicit jw-group overrides a stored story source', async () => {
  assert.deepEqual(await storefrontSourceScenario({ stored: 'story', search: '?src=jw-group' }), {
    source: 'jw-group', stored: 'jw-group',
  });
});

test('stored story persists across an untagged navigation', async () => {
  assert.deepEqual(await storefrontSourceScenario({ stored: 'story' }), {
    source: 'story', stored: 'story',
  });
});

test('an invalid explicit source cannot replace a valid stored source', async () => {
  assert.deepEqual(await storefrontSourceScenario({ stored: 'story', search: '?src=facebook' }), {
    source: 'story', stored: 'story',
  });
});

test('anonymous cart UUID is one-way hashed and never passed raw to storage', async () => {
  const captured = [];
  const result = await recordAnalyticsEvent({
    sessionId,
    event: { eventType: 'PRODUCT_VIEW', productId: 'product-1', campaignSource: 'story' },
  }, {
    query: async (sql, params) => {
      captured.push({ sql, params });
      return { rows: [{ event_id: 1 }] };
    },
  });
  assert.equal(result.accepted, true);
  assert.match(hashAnonymousSession(sessionId), /^[0-9a-f]{64}$/);
  assert.notEqual(hashAnonymousSession(sessionId), sessionId);
  assert.equal(JSON.stringify(captured).includes(sessionId), false);
  assert.equal(captured[0].params[1], hashAnonymousSession(sessionId));
});

test('deduplication suppresses the same source but preserves a legitimate source transition', async () => {
  assert.equal(dedupeWindowFor('CATALOG_VISIT'), '30 minutes');
  assert.equal(dedupeWindowFor('PRODUCT_VIEW'), '15 minutes');
  assert.equal(dedupeWindowFor('ADD_TO_CART'), '5 minutes');
  let queryText = '';
  const seen = new Set();
  const query = async (sql, params) => {
    queryText = sql;
    const key = JSON.stringify(params.slice(0, 6));
    if (seen.has(key)) return { rows: [] };
    seen.add(key);
    return { rows: [{ event_id: seen.size }] };
  };
  const contextualEvent = {
    eventType: 'PRODUCT_VIEW', productId: 'product-1', category: 'Muebles',
    filters: { availability: 'IMMEDIATE' }, resultPosition: 2, resultCount: 9,
    campaignSource: 'direct',
  };
  const first = await recordAnalyticsEvent({ sessionId, event: contextualEvent }, { query });
  const duplicate = await recordAnalyticsEvent({ sessionId, event: contextualEvent }, { query });
  const transitioned = await recordAnalyticsEvent({
    sessionId,
    event: { ...contextualEvent, campaignSource: 'story' },
  }, { query });
  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(transitioned.accepted, true);
  assert.match(queryText, /NOT EXISTS/);
  assert.match(queryText, /anonymous_session_hash IS NOT DISTINCT FROM/);
  assert.match(queryText, /campaign_source = \$4/);
  assert.match(queryText, /filter_context = \$6::jsonb/);
  assert.doesNotMatch(queryText, /search_term/);
});

test('public ingest has no read route and rejects public add-to-cart writes', async () => {
  const handler = createAnalyticsEventHandler({ recordEvent: async () => ({ accepted: true }) });
  assert.equal((await handler(new Request('https://example.com/api/analytics/event'))).status, 405);
  const response = await handler(new Request('https://example.com/api/analytics/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventType: 'ADD_TO_CART', productId: 'product-1' }),
  }));
  assert.equal(response.status, 400);
  const redirects = await readFile(new URL('../../../_redirects', import.meta.url), 'utf8');
  assert.match(redirects, /\/api\/analytics\/event\s+\/\.netlify\/functions\/analytics-event/);
  assert.doesNotMatch(redirects, /\/api\/analytics\/(?:events|report|sale-pulse)/);
});

test('explicit current UI context records one add-to-cart after a successful claim', async () => {
  let recorded = 0;
  let background;
  const handler = claimHandler({
    claimLease: async () => ({ items: { 'product-1': 1 }, expiresAt: now + 1000 }),
    recordEvent: async ({ event: recordedEvent }) => {
      recorded += 1;
      assert.equal(recordedEvent.eventType, 'ADD_TO_CART');
      assert.equal(recordedEvent.campaignSource, 'story');
    },
  });
  const response = await handler(claimRequest({ campaignSource: 'story' }), {
    waitUntil(promise) { background = promise; },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  await background;
  assert.equal(recorded, 1);
});

test('automatic legacy cart recovery claims succeed without add-to-cart tracking', async () => {
  let recorded = 0;
  const handler = claimHandler({
    claimLease: async () => ({ items: { 'product-1': 1 }, expiresAt: now + 1000 }),
    recordEvent: async () => { recorded += 1; },
  });
  const response = await handler(claimRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(recorded, 0);
});

test('a failed server claim records no add-to-cart event', async () => {
  let recorded = 0;
  const handler = claimHandler({
    claimLease: async () => { throw Object.assign(new Error('reserved'), { status: 409 }); },
    recordEvent: async () => { recorded += 1; },
  });
  assert.equal((await handler(claimRequest({ campaignSource: 'story' }))).status, 409);
  assert.equal(recorded, 0);
});

test('analytics failure never blocks a successful explicit cart claim', async () => {
  let background;
  const handler = claimHandler({
    claimLease: async () => ({ items: { 'product-1': 1 }, expiresAt: now + 1000 }),
    recordEvent: async () => { throw new Error('analytics unavailable'); },
  });
  const response = await handler(claimRequest({ campaignSource: 'story' }), {
    waitUntil(promise) { background = promise; },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  await background;
});

test('admin endpoint requires x-admin-token authorization before loading data', async () => {
  let loaded = false;
  const handler = createAdminSalePulseHandler({
    authorized: () => false,
    loadSnapshot: async () => { loaded = true; },
  });
  const response = await handler(new Request('https://example.com/api/admin/sale-pulse'));
  assert.equal(response.status, 401);
  assert.equal(loaded, false);
});

test('24-hour and 7-day analytics, visitors, source breakdown, and recent sales are factual', () => {
  const snapshot = buildSalePulseSnapshot({
    generatedAt: now,
    trackingStartedAt: hoursAgo(100),
    products: [product(1), product(2), product(3)],
    events: [
      event('CATALOG_VISIT', 2, { sessionHash: 'a'.repeat(64), campaignSource: 'story' }),
      event('CATALOG_VISIT', 3, { sessionHash: 'a'.repeat(64), campaignSource: 'story' }),
      event('PRODUCT_VIEW', 4, { productId: 'product-1', campaignSource: 'story' }),
      event('ADD_TO_CART', 5, { productId: 'product-1', campaignSource: 'story' }),
      event('CATALOG_VISIT', 30, { sessionHash: 'b'.repeat(64), campaignSource: 'jw-group' }),
      event('PRODUCT_VIEW', 31, { sessionHash: 'b'.repeat(64), productId: 'product-2', campaignSource: 'jw-group' }),
      event('CATALOG_VISIT', 200, { sessionHash: 'c'.repeat(64) }),
    ],
    orders: [
      { committedAt: hoursAgo(6), items: [{ productId: 'product-3', quantity: 2 }] },
      { committedAt: hoursAgo(40), items: [{ productId: 'product-2', quantity: 1 }] },
      { committedAt: hoursAgo(200), items: [{ productId: 'product-9', quantity: 5 }] },
    ],
  });
  assert.deepEqual(snapshot.last24Hours, {
    visitors: 1, catalogVisits: 2, productViews: 1, distinctProductsViewed: 1,
    addToCart: 1, confirmedOrders: 1, unitsSold: 2,
  });
  assert.equal(snapshot.last7Days.visitors, 2);
  assert.equal(snapshot.last7Days.catalogVisits, 3);
  assert.equal(snapshot.last7Days.confirmedOrders, 2);
  assert.equal(snapshot.last7Days.unitsSold, 3);
  assert.deepEqual(snapshot.sources.story, { visitors: 1, visits: 2, views: 1 });
  assert.deepEqual(snapshot.sources['jw-group'], { visitors: 1, visits: 1, views: 1 });
});

test('product signals rank deterministically without AI scoring', () => {
  const events = [
    event('PRODUCT_VIEW', 2, { productId: 'product-2' }),
    event('PRODUCT_VIEW', 3, { productId: 'product-1' }),
    event('PRODUCT_VIEW', 4, { productId: 'product-1', sessionHash: 'b'.repeat(64) }),
    event('ADD_TO_CART', 5, { productId: 'product-2' }),
    event('ADD_TO_CART', 6, { productId: 'product-2', sessionHash: 'b'.repeat(64) }),
  ];
  const snapshot = buildSalePulseSnapshot({
    generatedAt: now,
    trackingStartedAt: hoursAgo(48),
    products: [product(3), product(2), product(1)],
    purchasableInventory: availableInventory(1, 2, 3),
    events,
    orders: [],
  });
  assert.deepEqual(snapshot.productSignals.hotUnSold.map((item) => item.productId),
    ['product-2', 'product-1']);
  assert.deepEqual(snapshot.productSignals.cartInterestWithoutSale.map((item) => item.productId),
    ['product-2']);
  assert.deepEqual(snapshot.productSignals.viewedButNotAdded.map((item) => item.productId),
    ['product-1']);
  assert.equal(snapshot.productSignals.lowNoInterest[0].productId, 'product-3');
});

test('short tracking age prevents new inventory from being mislabeled low interest', () => {
  const snapshot = buildSalePulseSnapshot({
    generatedAt: now,
    trackingStartedAt: hoursAgo(2),
    products: [product(1), product(2)],
    events: [],
  });
  assert.equal(snapshot.tracking.lowInterestReady, false);
  assert.deepEqual(snapshot.productSignals.lowNoInterest, []);
  assert.match(snapshot.tracking.lowInterestGuard, /24 horas/);
});

for (const [label, productOverrides, rowOverrides, expected, purchasable] of [
  ['unique available without holds', {}, {}, 'MARKETABLE', 1],
  ['final unit CART hold', {}, { cart_held_quantity: 1, purchasable_quantity: 0 }, 'TEMPORARILY_RESERVED', 0],
  ['final unit ORDER hold', {}, { order_held_quantity: 1, purchasable_quantity: 0 }, 'PENDING_PAYMENT_OR_CONFIRMATION', 0],
  ['protected ORDER without expiry', {}, { order_held_quantity: 1, purchasable_quantity: 0, next_release_at: null }, 'PENDING_PAYMENT_OR_CONFIRMATION', 0],
  ['committed final unit with stale catalog', {}, { committed_quantity: 1, purchasable_quantity: 0 }, 'SOLD', 0],
  ['catalog SOLD', { status: 'SOLD' }, {}, 'SOLD', 1],
  ['catalog PICKED_UP', { status: 'PICKED_UP' }, {}, 'SOLD', 1],
  ['three units with one CART held', { quantityRemaining: 3 }, { capacity: 3, cart_held_quantity: 1, purchasable_quantity: 2 }, 'MARKETABLE', 2],
  ['all three units CART held', { quantityRemaining: 3 }, { capacity: 3, cart_held_quantity: 3, purchasable_quantity: 0 }, 'TEMPORARILY_RESERVED', 0],
  ['mixed CART and ORDER leaving one unit', { quantityRemaining: 3 }, { capacity: 3, cart_held_quantity: 1, order_held_quantity: 1, purchasable_quantity: 1 }, 'MARKETABLE', 1],
  ['mixed holds exhausting stock prioritize ORDER', { quantityRemaining: 3 }, { capacity: 3, cart_held_quantity: 2, order_held_quantity: 1, purchasable_quantity: 0 }, 'PENDING_PAYMENT_OR_CONFIRMATION', 0],
]) {
  test(`marketability: ${label}`, () => {
    const snapshot = buildSalePulseSnapshot({
      generatedAt: now, trackingStartedAt: hoursAgo(48),
      products: [product(1, productOverrides)],
      purchasableInventory: new Map([['product-1', inventoryRow(1, rowOverrides)]]),
      events: [event('PRODUCT_VIEW', 2, { productId: 'product-1' }), event('ADD_TO_CART', 1, { productId: 'product-1' })],
    });
    const packet = snapshot.marketingPacket;
    assert.equal(packet.products[0].marketabilityStatus, expected);
    assert.equal(packet.products[0].purchasableQuantity, purchasable);
    assert.equal(packet.marketableProducts.length, expected === 'MARKETABLE' ? 1 : 0);
    for (const items of Object.values(snapshot.productSignals)) {
      if (expected !== 'MARKETABLE') assert.equal(items.length, 0);
    }
    assert.equal(snapshot.last24Hours.productViews, 1);
    assert.equal(snapshot.last24Hours.addToCart, 1);
  });
}

test('internal public-projection exclusions never enter packet records or recommendations', () => {
  const snapshot = buildSalePulseSnapshot({
    products: [product(1, { status: 'NEEDS_REVIEW' }), product(2, { status: 'UNLISTED' })],
    purchasableInventory: availableInventory(1, 2),
  });
  assert.deepEqual(snapshot.marketingPacket.products, []);
  assert.deepEqual(snapshot.marketingPacket.marketableProducts, []);
  assert.equal(snapshot.marketingPacket.marketabilitySummary.notMarketable, 2);
});

test('missing inventory fails closed; catalog quantity caps marketing stock', () => {
  const missing = buildSalePulseSnapshot({ products: [product(1)] }).marketingPacket;
  assert.equal(missing.products[0].marketabilityReason, 'INVENTORY_NOT_VERIFIED');
  assert.equal(missing.products[0].purchasableQuantity, 0);
  assert.deepEqual(missing.marketableProducts, []);
  const capped = buildSalePulseSnapshot({
    products: [product(1)],
    purchasableInventory: new Map([['product-1', inventoryRow(1, { capacity: 3, purchasable_quantity: 3 })]]),
  }).marketingPacket;
  assert.equal(capped.products[0].purchasableQuantity, 1);
});

test('holds filter every recommendation without changing inventory, 24h/7d or traffic facts', () => {
  const input = {
    generatedAt: now, trackingStartedAt: hoursAgo(48),
    products: [product(1), product(2), product(3)],
    events: [
      event('PRODUCT_VIEW', 2, { productId: 'product-1', campaignSource: 'story' }),
      event('ADD_TO_CART', 1, { productId: 'product-1', campaignSource: 'story' }),
      event('PRODUCT_VIEW', 30, { productId: 'product-2', campaignSource: 'jw-group' }),
      event('CATALOG_VISIT', 1),
    ],
    orders: [{ committedAt: hoursAgo(1), items: [{ productId: 'other', quantity: 2 }] }],
  };
  const unheld = buildSalePulseSnapshot({ ...input, purchasableInventory: availableInventory(1, 2, 3) });
  const held = buildSalePulseSnapshot({
    ...input, purchasableInventory: new Map([1, 2, 3].map((number) => [
      `product-${number}`, inventoryRow(number, { cart_held_quantity: 1, purchasable_quantity: 0 }),
    ])),
  });
  for (const key of ['inventory', 'last24Hours', 'last7Days', 'sources']) assert.deepEqual(held[key], unheld[key]);
  for (const items of Object.values(unheld.productSignals)) assert.ok(items.length > 0);
  for (const items of Object.values(held.productSignals)) assert.deepEqual(items, []);
  assert.equal(held.marketingPacket.products[0].views, 1);
  assert.equal(held.marketingPacket.products[0].cartAdds, 1);
});

test('packet allowlist exports authoritative public facts and signal membership without PII or identifiers', () => {
  const privateFields = {
    buyer: { name: 'PRIVATE-BUYER', phone: 'PRIVATE-PHONE', email: 'PRIVATE-EMAIL' },
    orderId: 'PRIVATE-ORDER', checkoutId: 'PRIVATE-CHECKOUT', session_id: 'PRIVATE-SESSION',
    cartCookie: 'PRIVATE-COOKIE', accessToken: 'PRIVATE-TOKEN', receiptUrl: 'PRIVATE-RECEIPT',
    bankInformation: 'PRIVATE-BANK', sellerNotes: 'PRIVATE-SELLER-NOTES', customerNotes: 'PRIVATE-CUSTOMER-NOTES',
  };
  const packet = buildSalePulseSnapshot({
    generatedAt: now, trackingStartedAt: hoursAgo(48),
    products: [product(1, {
      ...privateFields, title: 'Título actual', slug: 'titulo-actual', category: 'Hogar',
      askingPricePYG: 175000, saleMode: 'IMMEDIATE', images: ['/images/example-cover.webp', '/images/example-second.webp'],
    })],
    purchasableInventory: new Map([['product-1', inventoryRow(1, privateFields)]]),
    events: [event('PRODUCT_VIEW', 1, { ...privateFields, productId: 'product-1' })],
    orders: [{ ...privateFields, committedAt: hoursAgo(1), items: [{ productId: 'other', quantity: 1 }] }],
  }).marketingPacket;
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, /PRIVATE-|buyer|phone|email|orderId|checkoutId|session|cookie|token|receipt|bank|sellerNotes|customerNotes/i);
  const record = packet.marketableProducts[0];
  assert.deepEqual(Object.keys(record).sort(), [
    'productId', 'itemNumber', 'title', 'views', 'cartAdds', 'slug', 'productUrl', 'category',
    'askingPricePYG', 'saleMode', 'mainImage', 'quantityRemaining', 'purchasableQuantity',
    'cartHeldQuantity', 'orderHeldQuantity', 'nextReleaseAt', 'marketabilityStatus', 'marketabilityReason', 'signals',
  ].sort());
  assert.equal(record.title, 'Título actual');
  assert.equal(record.askingPricePYG, 175000);
  assert.equal(record.mainImage, '/images/example-cover.webp');
  assert.equal(record.productUrl, '/producto/titulo-actual');
  assert.equal(record.views, 1);
  assert.equal(record.signals.hotUnsold, true);
  assert.deepEqual(packet.signalLists.hotUnsold, ['product-1']);
  assert.deepEqual(JSON.parse(serialized).marketableProducts[0], record);
});

for (const [label, images] of [
  ['empty images', []], ['missing images', undefined], ['null images', null], ['invalid cover', [null, '/images/second.webp']],
]) {
  test(`packet mainImage safely returns null for ${label}`, () => {
    const packet = buildSalePulseSnapshot({
      products: [product(1, { images })], purchasableInventory: availableInventory(1),
    }).marketingPacket;
    assert.equal(packet.marketableProducts[0].mainImage, null);
  });
}

test('packet mainImage uses only the first authoritative image and leaves image order unchanged', () => {
  const images = ['/images/example-cover.webp', '/images/example-second.webp', '/images/example-third.webp'];
  const source = product(1, { images, mainImage: '/stale-synthetic-cover.jpg' });
  const before = structuredClone(source);
  const record = buildSalePulseSnapshot({
    products: [source], purchasableInventory: availableInventory(1),
  }).marketingPacket.marketableProducts[0];
  assert.equal(record.mainImage, images[0]);
  assert.notEqual(record.mainImage, images[1]);
  assert.deepEqual(source, before);
});

test('packet cover follows current authoritative catalog adapter overrides without synthetic mainImage input', async () => {
  const base = await loadBaseCatalog('https://example.com');
  const source = base.find((item) => item.status === 'AVAILABLE' && item.quantityRemaining > 0 && item.images?.length);
  assert.ok(source, 'committed production catalog includes a public product with images');
  const originalImages = structuredClone(source.images);
  const overrideImages = ['/images/current-override-cover.webp', '/images/current-override-second.webp'];
  const authoritative = await loadCatalog('https://example.com', {
    loadBaseCatalog: async () => [source],
    listProductOverrides: async () => [{
      productId: source.id, images: overrideImages,
      publicFields: { title: 'Título actualizado', askingPricePYG: 189000 },
    }],
    readCommittedInventory: async () => new Map(),
  });
  assert.equal(Object.hasOwn(authoritative[0], 'mainImage'), false);
  const packet = buildSalePulseSnapshot({
    products: authoritative,
    purchasableInventory: new Map([[source.id, {
      ...inventoryRow(1), product_id: source.id,
      capacity: source.quantityRemaining, purchasable_quantity: source.quantityRemaining,
    }]]),
  }).marketingPacket;
  assert.deepEqual(authoritative[0].images, overrideImages);
  assert.equal(packet.marketableProducts[0].mainImage, authoritative[0].images[0]);
  assert.equal(packet.marketableProducts[0].title, 'Título actualizado');
  assert.equal(packet.marketableProducts[0].askingPricePYG, 189000);
  assert.deepEqual(source.images, originalImages);
});

test('purchasable inventory uses one passive aggregate with existing CART/ORDER expiry semantics', async () => {
  const queries = [];
  const row = inventoryRow(1, { cart_held_quantity: '1', order_held_quantity: '1', capacity: 3 });
  const result = await readPurchasableInventory({ query: async (sql) => {
    queries.push(sql);
    return { rows: [row] };
  } });
  assert.equal(result.get('product-1'), row);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^\s*SELECT/);
  assert.match(queries[0], /phase='CART' AND reservation.expires_at>clock_timestamp\(\)/);
  assert.match(queries[0], /phase='ORDER' AND\s*\(reservation.expires_at IS NULL OR reservation.expires_at>clock_timestamp\(\)\)/);
  assert.match(queries[0], /capacity-inventory.committed_quantity\s*-COALESCE\(holds.cart_held_quantity,0\)-COALESCE\(holds.order_held_quantity,0\)/);
  assert.doesNotMatch(queries[0], /\b(?:INSERT|UPDATE|DELETE|FOR UPDATE)\b|session_id|order_id|checkout_attempts/);
});

test('Sale Pulse load performs passive reads only, apart from existing analytics retention', async () => {
  const queries = [];
  const reservations = [inventoryRow(1, { cart_held_quantity: 1, purchasable_quantity: 0 })];
  const before = structuredClone(reservations);
  const snapshot = await loadSalePulseSnapshot('https://example.com', {
    loadProducts: async () => [product(1)],
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('FROM operational_inventory inventory')) return { rows: reservations };
      return { rows: [] };
    },
  });
  assert.equal(snapshot.marketingPacket.products[0].marketabilityStatus, 'TEMPORARILY_RESERVED');
  assert.deepEqual(reservations, before);
  assert.equal(queries.filter((sql) => /^\s*DELETE FROM sale_analytics_events/.test(sql)).length, 1);
  for (const sql of queries) {
    assert.ok(/^\s*SELECT\b|^\s*DELETE FROM sale_analytics_events\b/.test(sql));
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE)\b|DELETE FROM inventory_reservations|FOR UPDATE/);
  }
  const source = await readFile(new URL('../admin-sale-pulse.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /claimCartLease|updateCartLease|createCheckout|releaseCart|extendReservation/);
});

test('inventory read failure cannot fall back to marketing a held product', async () => {
  await assert.rejects(loadSalePulseSnapshot('https://example.com', {
    loadProducts: async () => [product(1)],
    query: async (sql) => {
      if (sql.includes('FROM operational_inventory inventory')) throw new Error('inventory unavailable');
      return { rows: [] };
    },
  }), /inventory unavailable/);
});

test('real PostgreSQL aggregate respects reservation expiry, phases and quantities without writes', async (t) => {
  // Isolated in-memory fixtures only. No production database or customer cart.
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE operational_inventory (product_id text PRIMARY KEY, capacity integer, committed_quantity integer);
    CREATE TABLE inventory_reservations (product_id text, quantity integer, phase text, expires_at timestamptz, session_id text);
  `);
  for (const fixture of [
    { label: 'no holds', capacity: 1, holds: [], purchasable: 1, cart: 0, order: 0, status: 'MARKETABLE' },
    { label: 'active CART', capacity: 1, holds: [['CART', 1, 'future']], purchasable: 0, cart: 1, order: 0, status: 'TEMPORARILY_RESERVED' },
    { label: 'expired CART', capacity: 1, holds: [['CART', 1, 'past']], purchasable: 1, cart: 0, order: 0, status: 'MARKETABLE' },
    { label: 'CART with no expiry is not active', capacity: 1, holds: [['CART', 1, null]], purchasable: 1, cart: 0, order: 0, status: 'MARKETABLE' },
    { label: 'active ORDER', capacity: 1, holds: [['ORDER', 1, 'future']], purchasable: 0, cart: 0, order: 1, status: 'PENDING_PAYMENT_OR_CONFIRMATION' },
    { label: 'protected ORDER without expiry', capacity: 1, holds: [['ORDER', 1, null]], purchasable: 0, cart: 0, order: 1, status: 'PENDING_PAYMENT_OR_CONFIRMATION' },
    { label: 'expired ORDER', capacity: 1, holds: [['ORDER', 1, 'past']], purchasable: 1, cart: 0, order: 0, status: 'MARKETABLE' },
    { label: 'committed unit is subtracted once', capacity: 1, committed: 1, holds: [['COMMITTED', 1, null]], purchasable: 0, cart: 0, order: 0, status: 'SOLD' },
    { label: 'three units one CART held', capacity: 3, holds: [['CART', 1, 'future']], purchasable: 2, cart: 1, order: 0, status: 'MARKETABLE' },
    { label: 'three units all CART held', capacity: 3, holds: [['CART', 3, 'future']], purchasable: 0, cart: 3, order: 0, status: 'TEMPORARILY_RESERVED' },
    { label: 'mixed CART and protected ORDER', capacity: 3, holds: [['CART', 1, 'future'], ['ORDER', 1, null]], purchasable: 1, cart: 1, order: 1, status: 'MARKETABLE' },
    { label: 'mixed holds consume final units', capacity: 3, holds: [['CART', 1, 'future'], ['ORDER', 2, null]], purchasable: 0, cart: 1, order: 2, status: 'PENDING_PAYMENT_OR_CONFIRMATION' },
  ]) {
    await t.test(fixture.label, async () => {
      await db.exec('DELETE FROM operational_inventory; DELETE FROM inventory_reservations');
      await db.query('INSERT INTO operational_inventory VALUES ($1,$2,$3)', ['product-1', fixture.capacity, fixture.committed || 0]);
      for (const [phase, units, expiry] of fixture.holds) {
        const expiresAt = expiry == null ? null : new Date(Date.now() + (expiry === 'past' ? -3600000 : 3600000)).toISOString();
        await db.query('INSERT INTO inventory_reservations VALUES ($1,$2,$3,$4,$5)', ['product-1', units, phase, expiresAt, 'PRIVATE-SESSION']);
      }
      const before = (await db.query('SELECT * FROM inventory_reservations')).rows;
      let reads = 0;
      const inventory = await readPurchasableInventory({ query: async (sql) => {
        assert.match(sql, /^\s*SELECT/);
        assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b/);
        reads += 1;
        return db.query(sql);
      } });
      assert.equal(reads, 1);
      const row = inventory.get('product-1');
      assert.equal(Number(row.purchasable_quantity), fixture.purchasable);
      assert.equal(Number(row.cart_held_quantity), fixture.cart);
      assert.equal(Number(row.order_held_quantity), fixture.order);
      const packet = buildSalePulseSnapshot({
        products: [product(1, { quantityRemaining: fixture.capacity - (fixture.committed || 0) })],
        purchasableInventory: inventory,
      }).marketingPacket;
      assert.equal(packet.products[0].marketabilityStatus, fixture.status);
      assert.equal(packet.products[0].purchasableQuantity, fixture.purchasable);
      assert.doesNotMatch(JSON.stringify(packet), /PRIVATE-SESSION|session_id/);
      assert.deepEqual((await db.query('SELECT * FROM inventory_reservations')).rows, before);
    });
  }
});

test('marketing brief contains factual metrics and no customer PII fields', () => {
  const snapshot = buildSalePulseSnapshot({
    generatedAt: now,
    trackingStartedAt: hoursAgo(30),
    products: [product(1)],
    operationalCounts: {
      paymentsRequiringAttention: 2,
      eligiblePickupsUnscheduled: 3,
      scheduledPickupsPending: 4,
    },
  });
  assert.match(snapshot.marketingBrief, /SALE PULSE/);
  assert.match(snapshot.marketingBrief, /Pagos pendientes: 2/);
  assert.match(snapshot.marketingBrief, /Retiros elegibles sin horario: 3/);
  assert.doesNotMatch(snapshot.marketingBrief, /buyer|phone|email|access.?token|receipt/i);
});

test('storefront records direct and contextual product views plus deliberate catalog controls', async () => {
  const tracker = await readFile(new URL('../../../js/sale-pulse.js', import.meta.url), 'utf8');
  const storefront = await readFile(new URL('../../../js/volume2-storefront.js', import.meta.url), 'utf8');
  const site = await readFile(new URL('../../../js/site.js', import.meta.url), 'utf8');
  assert.match(tracker, /discoveryFor\(product\)/);
  assert.match(tracker, /trackedProductViews\.has\(product\.id\)/);
  assert.match(tracker, /track\('PRODUCT_VIEW'/);
  assert.match(site, /dataset\.salePulseProductId/);
  assert.match(storefront, /salePulseRememberProductDiscovery/);
  assert.match(storefront, /resultPosition/);
  assert.match(storefront, /resultCount/);
  assert.match(storefront, /salePulseTrack\?\.\('CATEGORY_SELECT'/);
  assert.match(storefront, /salePulseTrack\?\.\('FILTER_APPLY'/);
  assert.match(storefront, /salePulseTrack\?\.\('SEARCH'/);
});

test('source-tagged landing parameters are read without modifying routing or URLs', async () => {
  const tracker = await readFile(new URL('../../../js/sale-pulse.js', import.meta.url), 'utf8');
  assert.match(tracker, /URLSearchParams\(window\.location\.search\)\.get\('src'\)/);
  assert.doesNotMatch(tracker, /history\.(?:pushState|replaceState)|location\.search\s*=/);
  assert.match(tracker, /sessionStorage\.setItem\(SOURCE_KEY/);
  assert.match(tracker, /try \{[\s\S]{0,100}sessionStorage\.getItem\(SOURCE_KEY\)/);
});
