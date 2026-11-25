import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import handler, { fullyDeliveredOrderIds } from '../admin-orders.mjs';
import { setInventoryDatabaseClientForTests } from './inventory-database.mjs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { jsonResponse } from './commerce.mjs';
import { normalizeProductId, orderItems } from './fulfillment-batches-core.mjs';

const endpoint = (await readFile(new URL('../admin-orders.mjs', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\r?\n/gm, '')
  .replace('export default async function handler', 'async function handler')
  .replace('export async function fullyDeliveredOrderIds', 'async function fullyDeliveredOrderIds');

test('delivery lookup failures return a safe explicit 503 with a unique logged reference and no orders', async () => {
  const orders = [{ id: 'SYNTHETIC', items: [{ productId: 'one', quantity: 1 }],
    buyer: { email: 'private@example.test' }, payments: [], remainingBalancePYG: 0 }];
  const before = JSON.stringify(orders), logs = [], calls = [];
  let failing = true, code = '08006';
  const context = {
    randomUUID, jsonResponse, normalizeProductId, orderItems,
    adminAuthorized: async () => true,
    listOrders: async () => { calls.push('orders'); return orders; },
    database: () => ({ pool: { query: async sql => {
      assert.match(sql, /^SELECT\b/);
      calls.push('delivery');
      if (failing) throw Object.assign(new Error('private@example.test postgres://secret@private-host raw SQL'), { code });
      return { rows: [{ order_id: 'SYNTHETIC', product_id: 'one' }] };
    } } }),
    console: { error: (...args) => logs.push(args) },
  };
  runInNewContext(endpoint + '\n;globalThis.handler = handler;', context);
  const references = new Set();
  for (const expectedCode of ['08006', 'UNKNOWN']) {
    const response = await context.handler(new Request('https://isolated.test/api/admin/orders'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.code, 'ORDER_DELIVERY_LOOKUP_FAILED');
    assert.match(body.errorReference, /^PEDIDOS-[0-9a-f-]{36}$/);
    assert.ok(body.error.includes(body.errorReference));
    assert.equal(Object.hasOwn(body, 'orders'), false);
    const [event, entry] = logs.at(-1);
    assert.equal(event, 'ADMIN_ORDERS_DELIVERY_LOOKUP_FAILED');
    assert.deepEqual(Object.keys(entry).sort(), ['code', 'errorReference']);
    assert.equal(entry.errorReference, body.errorReference);
    assert.equal(entry.code, expectedCode);
    assert.doesNotMatch(JSON.stringify([body, logs]), /private@example|postgres:|secret|private-host|raw SQL/);
    references.add(body.errorReference);
    code = 'private@example.test';
  }
  assert.equal(references.size, 2);
  failing = false;
  const recovered = await context.handler(new Request('https://isolated.test/api/admin/orders'));
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).orders[0].fullyDelivered, true);
  assert.deepEqual(calls, ['orders', 'delivery', 'orders', 'delivery', 'orders', 'delivery']);
  assert.equal(logs.length, 2);
  assert.equal(JSON.stringify(orders), before);
});

test('order listing awaits authorization and rejects unsupported methods before business reads', async () => {
  const previous = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'synthetic-orders-owner';
  setInventoryDatabaseClientForTests({ pool: { query() { throw new Error('Unexpected database read'); } } });
  try {
    for (const method of ['GET', 'POST']) {
      const response = await handler(new Request('https://isolated.test/api/admin/orders', { method }));
      assert.equal(response.status, 401);
    }
    const response = await handler(new Request('https://isolated.test/api/admin/orders', {
      method: 'POST', headers: { 'x-admin-token': 'synthetic-orders-owner' },
    }));
    assert.equal(response.status, 405);
  } finally {
    setInventoryDatabaseClientForTests(undefined);
    if (previous === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previous;
  }
});

test('delivery summary reads every item assignment and current batch status without writes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE fulfillment_batches (
      fulfillment_batch_id text PRIMARY KEY, status text, merged_into_batch_id text);
      CREATE TABLE fulfillment_batch_items (
        order_id text, product_id text, fulfillment_batch_id text,
        PRIMARY KEY (order_id, product_id));
      INSERT INTO fulfillment_batches VALUES
        ('delivered', 'DELIVERED', NULL), ('open', 'OPEN', NULL),
        ('prepared', 'PREPARED', NULL), ('legacy', 'LEGACY_FROZEN', NULL),
        ('merged', 'DELIVERED', 'open');
      INSERT INTO fulfillment_batch_items VALUES
        ('full', 'one', 'delivered'), ('full', 'two', 'delivered'),
        ('partial', 'one', 'delivered'), ('partial', 'two', 'prepared'),
        ('missing', 'one', 'delivered'), ('unpaid', 'one', 'delivered'),
        ('cancelled', 'one', 'delivered'), ('open', 'one', 'open'),
        ('legacy', 'one', 'legacy'), ('merged', 'one', 'merged'),
        ('wrong-order', 'one', 'delivered'), ('reopened', 'one', 'open');`);
    const order = (id, ids = ['one']) => ({ id,
      items: ids.map(productId => ({ productId, quantity: 2 })) });
    const orders = [order('full', ['one', ' \ttwo\r\n']), order('partial', ['one', 'two']),
      order('missing', ['one', 'two']), order('unpaid'), order('cancelled'),
      order('open'), order('legacy'), order('merged'), order('reopened'), order('unassigned'),
      order('empty', []), order('malformed', [null]), { id: 'no-items' }];
    const before = JSON.stringify(orders);
    await db.exec('BEGIN READ ONLY');
    assert.deepEqual([...await fullyDeliveredOrderIds(orders, db)], ['full', 'unpaid', 'cancelled']);
    assert.deepEqual([...await fullyDeliveredOrderIds([], db)], []);
    assert.equal(JSON.stringify(orders), before);
    await db.exec('ROLLBACK');
  } finally {
    await db.close();
  }
});
