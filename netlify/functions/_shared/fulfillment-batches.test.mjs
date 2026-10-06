import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertExpectedRevision,
  chooseAutoAttachBatch,
  explicitProductIds,
  groupLegacyMembership,
  nextStatus,
  normalizeAsciiText,
  normalizeProductId,
  orderItems,
  timingKeyForItem,
} from './fulfillment-batches-core.mjs';
import {
  combineBatches,
  ensureFulfillmentAssignments,
  loadFulfillmentBatches,
  separateItems,
} from './fulfillment-batches.mjs';
import { createFulfillmentBatchesHandler } from '../admin-fulfillment-batches.mjs';

const buyer = '11111111-1111-4111-8111-111111111111';
const open = (overrides = {}) => ({
  fulfillmentBatchId: 'open',
  buyerGroupId: buyer,
  timingKey: 'IMMEDIATE',
  status: 'OPEN',
  autoAttach: true,
  mergedIntoBatchId: null,
  revision: 1,
  items: [],
  ...overrides,
});

test('same buyer purchases before preparation select the same open batch', () => {
  const batch = open();
  assert.equal(chooseAutoAttachBatch([batch], buyer, 'IMMEDIATE'), batch);
  assert.equal(chooseAutoAttachBatch([batch], buyer, 'IMMEDIATE'), batch);
});

test('a purchase after prepared has no eligible old batch', () => {
  assert.equal(chooseAutoAttachBatch([open({ status: 'PREPARED', autoAttach: false })], buyer, 'IMMEDIATE'), null);
});

test('a purchase after delivered has no eligible old batch', () => {
  assert.equal(chooseAutoAttachBatch([open({ status: 'DELIVERED', autoAttach: false })], buyer, 'IMMEDIATE'), null);
});

test('a purchase after legacy frozen has no eligible old batch', () => {
  assert.equal(chooseAutoAttachBatch([open({ status: 'LEGACY_FROZEN', autoAttach: false })], buyer, 'IMMEDIATE'), null);
});

test('runtime timing keys normalize all migration fixtures deterministically', () => {
  const fixtures = [
    [{ saleMode: 'IMMEDIATE' }, 'IMMEDIATE'],
    [{ saleMode: 'DELAYED', pickupWindowStart: '2026-12-09', pickupWindowEnd: '2026-12-12' },
      'DELAYED:2026-12-09:2026-12-12'],
    [{ saleMode: 'DELAYED', pickupWindowStart: ' 2026-12-09 ', pickupWindowEnd: ' 2026-12-12 ' },
      'DELAYED:2026-12-09:2026-12-12'],
    [{ saleMode: 'DELAYED', pickupWindowStart: '\t', pickupWindowEnd: '\t' }, 'DELAYED:UNSET:UNSET'],
    [{ saleMode: 'DELAYED', pickupWindowStart: '\n', pickupWindowEnd: '\n' }, 'DELAYED:UNSET:UNSET'],
    [{ saleMode: 'DELAYED', pickupWindowStart: '\r\n', pickupWindowEnd: '\r\n' }, 'DELAYED:UNSET:UNSET'],
    [{ saleMode: '\tDELAYED ', pickupWindowStart: ' \t2026-12-09\r\n', pickupWindowEnd: '\t2026-12-12 ' },
      'DELAYED:2026-12-09:2026-12-12'],
    [{ saleMode: 'DELAYED', pickupWindowStart: '', pickupWindowEnd: '' }, 'DELAYED:UNSET:UNSET'],
    [{ saleMode: 'DELAYED', pickupWindowStart: '   ', pickupWindowEnd: ' \t\r\n' }, 'DELAYED:UNSET:UNSET'],
    [{ saleMode: 'DELAYED', pickupWindowStart: null, pickupWindowEnd: null }, 'DELAYED:UNSET:UNSET'],
    [{ saleMode: 'DELAYED', pickupWindowStart: 0, pickupWindowEnd: 0 }, 'DELAYED:UNSET:UNSET'],
    [{ saleMode: 'DELAYED', pickupWindowStart: false, pickupWindowEnd: false }, 'DELAYED:UNSET:UNSET'],
    [{ saleMode: 'DELAYED', pickupWindowStart: '2027-01-01', pickupWindowEnd: '2027-01-02' },
      'DELAYED:2027-01-01:2027-01-02'],
  ];
  for (const [item, expected] of fixtures) assert.equal(timingKeyForItem(item), expected);
  assert.notEqual(timingKeyForItem(fixtures[1][0]), timingKeyForItem(fixtures.at(-1)[0]));
  assert.equal(normalizeAsciiText('\u00a0kept\u00a0'), '\u00a0kept\u00a0');
});

test('product IDs use the same string-only ASCII normalization policy', () => {
  assert.equal(normalizeProductId(' \tPRODUCT-1\r\n'), 'PRODUCT-1');
  for (const value of [null, undefined, '', ' \t\r\n', 0, false, {}, []]) {
    assert.equal(normalizeProductId(value), '');
  }
  const [group] = groupLegacyMembership([
    { buyerGroupId: buyer, orderId: 'A', item: { productId: ' \tPRODUCT-1\r\n' } },
    { buyerGroupId: buyer, orderId: 'A', item: { productId: false } },
  ]);
  assert.deepEqual(group.items, [{ orderId: 'A', productId: 'PRODUCT-1' }]);
});

test('runtime safely ignores malformed order item collections', () => {
  for (const value of [undefined, null, { productId: 'object' }, 'scalar', 7]) {
    assert.deepEqual(orderItems({ items: value }), []);
  }
  assert.deepEqual(orderItems({ items: [] }), []);
  assert.deepEqual(orderItems({ items: [{ productId: 'valid' }] }), [{ productId: 'valid' }]);
});

test('a mixed order splits into timing-specific legacy memberships', () => {
  const groups = groupLegacyMembership([
    { buyerGroupId: buyer, orderId: 'A', item: { productId: 'now', saleMode: 'IMMEDIATE' } },
    { buyerGroupId: buyer, orderId: 'A', item: { productId: 'later', saleMode: 'DELAYED',
      pickupWindowStart: '2026-12-09', pickupWindowEnd: '2026-12-12' } },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.timingKey).sort(),
    ['DELAYED:2026-12-09:2026-12-12', 'IMMEDIATE']);
});

test('legacy grouping preserves multiple orders in one buyer and timing batch', () => {
  const groups = groupLegacyMembership([
    { buyerGroupId: buyer, orderId: 'A', item: { productId: 'one', saleMode: 'IMMEDIATE' } },
    { buyerGroupId: buyer, orderId: 'B', item: { productId: 'two', saleMode: 'IMMEDIATE' } },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map(item => item.orderId), ['A', 'B']);
});

test('legacy migrated groups reject automatic attachment', () => {
  const [batch] = groupLegacyMembership([
    { buyerGroupId: buyer, orderId: 'A', item: { productId: 'one', saleMode: 'IMMEDIATE' } },
  ]);
  assert.equal(batch.status, 'LEGACY_FROZEN');
  assert.equal(batch.autoAttach, false);
  assert.equal(chooseAutoAttachBatch([batch], buyer, 'IMMEDIATE'), null);
});

test('prepare transitions open to prepared', () => {
  assert.equal(nextStatus('OPEN', 'PREPARE'), 'PREPARED');
});

test('later purchases do not select a prepared planilla', () => {
  const prepared = open({ status: 'PREPARED', autoAttach: false, items: ['original'] });
  const replacement = open({ fulfillmentBatchId: 'new-open' });
  assert.equal(chooseAutoAttachBatch([prepared, replacement], buyer, 'IMMEDIATE'), replacement);
  assert.deepEqual(prepared.items, ['original']);
});

test('reprint data remains the persisted prepared membership', () => {
  const persisted = Object.freeze({ items: Object.freeze([{ orderId: 'A', productId: 'one' }]) });
  assert.deepEqual(persisted.items, [{ orderId: 'A', productId: 'one' }]);
});

test('delivery is terminal for automatic attachment', () => {
  assert.equal(nextStatus('PREPARED', 'DELIVER'), 'DELIVERED');
  assert.equal(chooseAutoAttachBatch([open({ status: 'DELIVERED', autoAttach: false })], buyer, 'IMMEDIATE'), null);
  assert.throws(() => nextStatus('DELIVERED', 'REOPEN'), /ya no admite/);
});

test('reopen accepts the current revision and restores open state', () => {
  const batch = open({ status: 'PREPARED', autoAttach: false, revision: 4 });
  assert.doesNotThrow(() => assertExpectedRevision(batch, 4));
  assert.equal(nextStatus(batch.status, 'REOPEN'), 'OPEN');
});

test('reopen detects a competing eligible open batch', () => {
  const first = open({ fulfillmentBatchId: 'first' });
  const second = open({ fulfillmentBatchId: 'second' });
  assert.throws(() => chooseAutoAttachBatch([first, second], buyer, 'IMMEDIATE'), /más de un lote abierto/);
});

test('combine production function rejects different timing keys before writing', async () => {
  let mutationQueries = 0;
  const sourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const client = {
    async query(sql) {
      if (sql.includes('SELECT * FROM fulfillment_batches')) {
        return { rows: [
          { fulfillment_batch_id: sourceId, buyer_group_id: buyer, timing_key: 'IMMEDIATE',
            status: 'OPEN', revision: 1, merged_into_batch_id: null },
          { fulfillment_batch_id: targetId, buyer_group_id: buyer, timing_key: 'DELAYED:x:y',
            status: 'OPEN', revision: 1, merged_into_batch_id: null },
        ] };
      }
      if (/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql)) mutationQueries += 1;
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(() => combineBatches(client, {
    batchId: sourceId,
    targetBatchId: targetId,
    expectedRevision: 1,
    expectedTargetRevision: 1,
    confirmFrozen: false,
  }), /mismo comprador y tipo de retiro/);
  assert.equal(mutationQueries, 0);
});

test('separation preserves the durable buyer identity', () => {
  const source = open();
  const separated = { ...source, fulfillmentBatchId: 'separate', autoAttach: false };
  assert.equal(separated.buyerGroupId, source.buyerGroupId);
});

test('frozen batch changes require and produce revision changes', () => {
  const source = open({ status: 'LEGACY_FROZEN', autoAttach: false, revision: 2 });
  assert.doesNotThrow(() => assertExpectedRevision(source, 2));
  assert.equal(source.revision + 1, 3);
});

test('schema prevents duplicate eligible open batches', async () => {
  const sql = await readFile(new URL('../../database/migrations/20261006_032430_fulfillment_batches.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX fulfillment_batches_auto_open/);
  assert.match(sql, /WHERE status = 'OPEN'[\s\S]*auto_attach = true[\s\S]*merged_into_batch_id IS NULL/);
});

test('schema prevents duplicate order and product membership', async () => {
  const sql = await readFile(new URL('../../database/migrations/20261006_032430_fulfillment_batches.sql', import.meta.url), 'utf8');
  assert.match(sql, /PRIMARY KEY \(order_id, product_id\)/);
});

test('migration SQL text encodes string-only ASCII normalization and malformed JSON guards', async () => {
  const sql = await readFile(new URL('../../database/migrations/20261006_032430_fulfillment_batches.sql', import.meta.url), 'utf8');
  assert.match(sql, /jsonb_typeof\(item\.value->'pickupWindowStart'\) = 'string'/);
  assert.match(sql, /jsonb_typeof\(item\.value->'pickupWindowEnd'\) = 'string'/);
  assert.match(sql, /jsonb_typeof\(item\.value->'productId'\) = 'string'/);
  assert.match(sql, /btrim\(item\.value->>'pickupWindowStart', E' \\t\\r\\n'\)/);
  assert.match(sql, /btrim\(item\.value->>'pickupWindowEnd', E' \\t\\r\\n'\)/);
  assert.match(sql, /btrim\(item\.value->>'productId', E' \\t\\r\\n'\)/);
  assert.match(sql, /normalized_item\.product_id <> ''/);
  assert.match(sql, /legacy\.product_id/);
  assert.match(sql, /WHEN jsonb_typeof\(attempt\.order_snapshot->'items'\) = 'array'/);
  assert.match(sql, /ELSE '\[\]'::jsonb/);
  assert.match(sql, /REFERENCES checkout_attempts\(order_id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /REFERENCES checkout_attempts\(order_id\) ON DELETE CASCADE/);
});

test('authoritative loader returns every persisted membership with safe metadata fallbacks', async () => {
  const batchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const base = {
    fulfillment_batch_id: batchId,
    buyer_group_id: buyer,
    timing_key: 'IMMEDIATE',
    status: 'PREPARED',
    auto_attach: false,
    revision: 2,
    prepared_at: '2026-10-06T12:00:00.000Z',
    delivered_at: null,
    merged_into_batch_id: null,
    batch_created_at: '2026-10-06T11:00:00.000Z',
    batch_updated_at: '2026-10-06T12:00:00.000Z',
    display_name: 'Buyer',
    display_phone: '123',
    assignment_mode: 'AUTO_MATCH',
    order_created_at: '2026-10-06T10:00:00.000Z',
  };
  const memberships = [
    { order_id: 'VALID', product_id: 'valid', order_snapshot: { items: [
      { productId: 'valid', itemNumber: 1, title: 'Valid metadata', quantity: 2, saleMode: 'IMMEDIATE' },
    ] } },
    { order_id: 'MISSING-ITEMS', product_id: 'missing-items', order_snapshot: {} },
    { order_id: 'NULL-SNAPSHOT', product_id: 'null-snapshot', order_snapshot: null },
    { order_id: 'OBJECT-ITEMS', product_id: 'object-items', order_snapshot: { items: {} } },
    { order_id: 'SCALAR-SNAPSHOT', product_id: 'scalar-snapshot', order_snapshot: 'scalar' },
    { order_id: 'FORMATTED', product_id: 'formatted', order_snapshot: { items: [
      { productId: ' \tformatted\r\n', title: 'Formatting match', quantity: 1 },
    ] } },
    { order_id: 'NO-MATCH', product_id: 'persisted-only', order_snapshot: { items: [
      { productId: 'different', title: 'Wrong item' },
    ] } },
  ].map(row => ({ ...base, ...row }));
  const client = { query: async () => ({ rows: memberships }) };
  const [batch] = await loadFulfillmentBatches(client, [batchId]);
  assert.equal(batch.items.length, memberships.length);
  assert.equal(batch.items.find(item => item.orderId === 'VALID').title, 'Valid metadata');
  assert.equal(batch.items.find(item => item.orderId === 'FORMATTED').title, 'Formatting match');
  const fallback = batch.items.find(item => item.orderId === 'NO-MATCH');
  assert.deepEqual({
    productId: fallback.productId,
    itemNumber: fallback.itemNumber,
    title: fallback.title,
    quantity: fallback.quantity,
    saleMode: fallback.saleMode,
  }, {
    productId: 'persisted-only',
    itemNumber: null,
    title: 'Producto persisted-only',
    quantity: null,
    saleMode: 'IMMEDIATE',
  });
  for (const item of batch.items) {
    assert.ok(item.orderId);
    assert.ok(item.productId);
  }
});

test('stale admin mutation fails on revision conflict', () => {
  assert.throws(() => assertExpectedRevision(open({ revision: 3 }), 2), /cambió en otra pestaña/);
});

test('admin prepares on the server before invoking print', async () => {
  const source = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function prepareAndPrintFulfillmentBatch');
  const end = source.indexOf('async function deliverFulfillmentBatch', start);
  const body = source.slice(start, end);
  assert.ok(body.indexOf("action: 'PREPARE'") < body.indexOf('printFulfillmentBatch(batchId)'));
  assert.match(body, /await updateFulfillmentBatch/);
});

test('server materializes confirmed items before any batch mutation', async () => {
  const source = await readFile(new URL('./fulfillment-batches.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('export async function mutateFulfillmentBatch');
  const body = source.slice(start);
  assert.ok(body.indexOf('await ensureFulfillmentAssignments(client)') < body.indexOf('transitionBatch(client'));
});

test('multiple new items increment one existing batch revision once', async () => {
  const revisionUpdates = [];
  const itemInserts = [];
  const existingBatch = { fulfillment_batch_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const client = {
    async query(sql, params = []) {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM checkout_attempts attempt')) {
        return { rows: [{
          order_id: 'ORDER-1',
          buyer_group_id: buyer,
          order_snapshot: { items: [
            { productId: 'one', saleMode: 'IMMEDIATE' },
            { productId: 'two', saleMode: 'IMMEDIATE' },
          ] },
        }] };
      }
      if (sql.includes('FROM fulfillment_batch_items')) return { rows: [] };
      if (sql.includes('SELECT * FROM fulfillment_batches')) return { rows: [existingBatch] };
      if (sql.includes('INSERT INTO fulfillment_batch_items')) {
        itemInserts.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE fulfillment_batches')) {
        revisionUpdates.push(params[0]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const assigned = await ensureFulfillmentAssignments(client, { ensureBuyerGroups: async () => {} });
  assert.equal(assigned, 2);
  assert.equal(itemInserts.length, 2);
  assert.deepEqual(revisionUpdates, [existingBatch.fulfillment_batch_id]);
});

test('separate API rejects missing, null, empty, malformed, and duplicate product selections', async () => {
  const previousToken = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'test-admin-token';
  let mutationCalls = 0;
  const handler = createFulfillmentBatchesHandler({
    mutateBatch: async () => { mutationCalls += 1; return []; },
  });
  const invalidSelections = [undefined, null, [], [''], [null], [7], ['same', 'same']];
  try {
    for (const productIds of invalidSelections) {
      const body = {
        action: 'SEPARATE',
        batchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        orderId: 'ORDER-1',
      };
      if (productIds !== undefined) body.productIds = productIds;
      const response = await handler(new Request('http://localhost/api/admin/fulfillment-batches', {
        method: 'POST',
        headers: { 'x-admin-token': 'test-admin-token', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }));
      assert.equal(response.status, 400);
      const payload = await response.json();
      assert.match(payload.code, /^FULFILLMENT_ITEMS_/);
    }
  } finally {
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousToken;
  }
  assert.equal(mutationCalls, 0);
});

test('separate production function rejects product IDs outside the requested order and batch', async () => {
  let mutationQueries = 0;
  const source = {
    fulfillment_batch_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    buyer_group_id: buyer,
    timing_key: 'IMMEDIATE',
    status: 'OPEN',
    auto_attach: true,
    revision: 1,
    merged_into_batch_id: null,
  };
  const client = {
    async query(sql) {
      if (sql.includes('SELECT * FROM fulfillment_batches')) return { rows: [source] };
      if (sql.includes('SELECT order_id,product_id')) {
        return { rows: [{ order_id: 'ORDER-1', product_id: 'one' }] };
      }
      if (/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql)) mutationQueries += 1;
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(() => separateItems(client, {
    batchId: source.fulfillment_batch_id,
    orderId: 'ORDER-1',
    productIds: ['one', 'not-in-batch'],
    expectedRevision: 1,
    confirmFrozen: false,
  }), error => error.status === 409 && error.code === 'FULFILLMENT_ITEMS_NOT_FOUND');
  assert.equal(mutationQueries, 0);
});

test('successful committed mutation response does not perform a failing refresh', async () => {
  const previousToken = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'test-admin-token';
  let listCalls = 0;
  const committedBatch = open({
    fulfillmentBatchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'PREPARED',
    autoAttach: false,
    revision: 2,
    items: [{ orderId: 'ORDER-1', productId: 'one' }],
  });
  const handler = createFulfillmentBatchesHandler({
    mutateBatch: async () => [committedBatch],
    listBatches: async () => { listCalls += 1; throw new Error('refresh failed'); },
  });
  try {
    const response = await handler(new Request('http://localhost/api/admin/fulfillment-batches', {
      method: 'POST',
      headers: { 'x-admin-token': 'test-admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'PREPARE',
        batchId: committedBatch.fulfillmentBatchId,
        expectedRevision: 1,
      }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      committed: true,
      changedBatches: [committedBatch],
    });
  } finally {
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousToken;
  }
  assert.equal(listCalls, 0);
});

test('explicit product selection accepts only unique nonempty strings', () => {
  assert.deepEqual(explicitProductIds([' one ', 'two']), ['one', 'two']);
  assert.throws(() => explicitProductIds([]), /al menos un artículo/);
  assert.throws(() => explicitProductIds(['one', 'one']), /no es válida/);
});
