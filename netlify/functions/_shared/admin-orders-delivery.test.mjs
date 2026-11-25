import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import handler, { fullyDeliveredOrderIds } from '../admin-orders.mjs';
import { setInventoryDatabaseClientForTests } from './inventory-database.mjs';

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
