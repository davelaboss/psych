import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createAnalyticsEventHandler } from '../analytics-event.mjs';
import { createAdminSalePulseHandler } from '../admin-sale-pulse.mjs';
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
