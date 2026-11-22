import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { chromium } from 'playwright';
import { migrateRetentionFixture } from './test-support/historical-retention-fixture.mjs';
import { setInventoryDatabaseClientForTests } from './inventory-database.mjs';
import { mutateFulfillmentBatch, transitionBatch } from './fulfillment-batches.mjs';
import { createFulfillmentBatchesHandler } from '../admin-fulfillment-batches.mjs';
import sessionHandler from '../admin-session.mjs';

const origin = 'https://delivery.test';
const credential = 'synthetic-owner-delivery-only';
const authorization = { confirmed: true, reason: 'Pago verificado personalmente; autorizo el retiro.' };
const owner = { actor: 'OWNER' };
const previousToken = process.env.ADMIN_TOKEN;
let db;
const handler = createFulfillmentBatchesHandler();
const poolFor = client => ({ query: (...a) => client.query(...a),
  connect: async () => ({ query: (...a) => client.query(...a), release() {} }) });
test.before(async () => {
  db = new PGlite();
  await migrateRetentionFixture(db);
  setInventoryDatabaseClientForTests({ pool: poolFor(db) });
  process.env.ADMIN_TOKEN = credential;
});
test.after(async () => {
  setInventoryDatabaseClientForTests(undefined);
  if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = previousToken;
  await db.close();
});

async function fixture(client = db, { paid = false, state = 'PREPARED', orderId = 'SYNTHETIC-' + randomUUID(), assigned = true } = {}) {
  const batchId = randomUUID(), group = randomUUID(), session = randomUUID();
  const items = [0, 1].map(() => ({ productId: randomUUID(), title: 'Synthetic Item', quantity: 1,
    saleMode: 'IMMEDIATE', unitPricePYG: 100, dueNowPYG: 100, futureBalancePYG: 0 }));
  const order = { id: orderId, status: 'PAYMENT_CONFIRMED', buyer: { name: 'Synthetic', phone: '000' }, items,
    totals: { totalPYG: 200, dueNowPYG: 200, futureBalancePYG: 0 },
    payments: [{ id: randomUUID(), amountPYG: 200, verificationStatus: 'CONFIRMED', verifiedBy: 'ADMIN',
      ...(paid ? { amountSource: 'ADMIN_VERIFIED' } : {}), receipt: { fileName: 'synthetic.png', storageKey: 'synthetic-only' } }],
    paymentAdjustments: [] };
  await client.query('INSERT INTO cart_sessions(session_id) VALUES($1)', [session]);
  await client.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,committed_at)
    VALUES($1,$2,$3,0,'synthetic',$4,clock_timestamp())`, [orderId, session, randomUUID(), JSON.stringify(order)]);
  if (!assigned) return { order, session };
  await client.query("INSERT INTO buyer_groups(buyer_group_id,display_name) VALUES($1,'Synthetic')", [group]);
  await client.query(`INSERT INTO buyer_group_orders(order_id,buyer_group_id,normalized_name,normalized_phone,assignment_mode)
    VALUES($1,$2,'synthetic','000','AUTO_NEW')`, [orderId, group]);
  await client.query(`INSERT INTO fulfillment_batches(fulfillment_batch_id,buyer_group_id,timing_key,status,auto_attach,prepared_at)
    VALUES($1,$2,'IMMEDIATE',$3,false,clock_timestamp())`, [batchId, group, state]);
  if (state === 'CLOSED_OWNER_WITHDRAWAL') return { order, batchId, session };
  for (const item of items) {
    await client.query("INSERT INTO fulfillment_batch_items(order_id,product_id,fulfillment_batch_id,assignment_mode) VALUES($1,$2,$3,'AUTO_NEW')", [orderId, item.productId, batchId]);
    await client.query('INSERT INTO operational_inventory(product_id,capacity,committed_quantity) VALUES($1,1,1)', [item.productId]);
    await client.query("INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,order_id) VALUES($1,$2,1,'COMMITTED',$3)", [item.productId, session, orderId]);
  }
  return { order, batchId, session };
}
const deliver = (f, extra = {}) => ({ action: 'DELIVER', batchId: f.batchId, expectedRevision: 1, ...extra });
const approved = (f, extra = {}) => deliver(f, { ownerDeliveryAuthorization: authorization, ...extra });
const request = (body, headers = { 'x-admin-token': credential }) => new Request(origin + '/api/admin/fulfillment-batches', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function state(client = db) {
  const tables = ['checkout_attempts', 'operational_inventory', 'inventory_reservations', 'cart_sessions',
    'buyer_groups', 'buyer_group_orders', 'fulfillment_batch_items', 'item_payment_decisions', 'pickup_appointments', 'seller_notifications'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table,
    (await client.query(`SELECT * FROM ${table}`)).rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) ])));
}
const events = async (f, client = db) => (await client.query('SELECT * FROM fulfillment_batch_events WHERE fulfillment_batch_id=$1 ORDER BY event_id', [f.batchId])).rows;

test('normal fully paid multi-Item delivery needs no allocation or owner authorization', async () => {
  const f = await fixture(db, { paid: true }), before = await state();
  const response = await handler(request(deliver(f)));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).changedBatches[0].status, 'DELIVERED');
  assert.deepEqual(await state(), before);
  assert.deepEqual((await events(f))[0].context, {});
});

test('historical evidence gets a specific offer; explicit OWNER authorization records delivery only', async () => {
  const f = await fixture(), before = await state();
  const blocked = await handler(request(deliver(f)));
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'DELIVERY_PAYMENT_EVIDENCE_REQUIRED');
  assert.deepEqual(await events(f), []);
  const response = await handler(request(approved(f, { actor: 'REVIEWER' })));
  assert.equal(response.status, 200);
  const batch = (await response.json()).changedBatches[0];
  assert.equal(batch.status, 'DELIVERED'); assert.equal(batch.revision, 2); assert.ok(batch.deliveredAt);
  const [event] = await events(f);
  assert.equal(event.actor, 'OWNER'); assert.equal(event.event_type, 'DELIVER'); assert.ok(event.created_at);
  assert.deepEqual(event.revisions, { before: 1, after: 2 });
  assert.deepEqual(event.affected_items, f.order.items.map(i => ({ orderId: f.order.id, productId: i.productId })).sort((a,b) => a.productId.localeCompare(b.productId)));
  assert.equal(event.context.kind, 'OWNER_DELIVERY_AUTHORIZATION');
  assert.equal(event.context.reason, authorization.reason); assert.equal(event.context.paymentEvidenceBypassed, true);
  assert.deepEqual(event.context.paymentEvidenceBlockedItems, event.affected_items);
  assert.deepEqual(await state(), before, 'all financial records, memberships, inventory, appointments and notifications stay identical');
  const retry = await handler(request(approved(f)));
  assert.equal(retry.status, 409); assert.equal((await events(f)).length, 1);
});

test('real OWNER cookie is accepted; REVIEWER cookie and forged roles never grant authority', async () => {
  const f = await fixture();
  for (const headers of [{}, { 'x-admin-role': 'OWNER', cookie: 'mudanza_reviewer_session=synthetic' },
    { 'x-admin-token': 'reviewer', 'x-admin-role': 'OWNER' }]) {
    assert.equal((await handler(request(approved(f), headers))).status, 401);
  }
  const login = await sessionHandler(new Request(origin + '/api/admin/session', { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'login', token: credential }) }));
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await handler(request(approved(f), { origin: 'https://foreign.test', cookie }))).status, 401);
  assert.equal((await handler(request(approved(f), { origin, cookie }))).status, 200);
});

test('OWNER delivery preserves partial funds, receipts, refunds and pre-existing Item exceptions verbatim', async () => {
  const f = await fixture(db, { paid: true });
  f.order.status = 'DEPOSIT_CONFIRMED';
  f.order.payments[0].amountPYG = 25;
  f.order.paymentAdjustments = [{ id: randomUUID(), kind: 'POST_SALE_PRICE_ADJUSTMENT', amountPYG: 5, internalNote: 'Synthetic historical refund' }];
  f.order.remainingBalancePYG = 175;
  await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1', [f.order.id, JSON.stringify(f.order)]);
  await db.query(`INSERT INTO item_payment_decisions(id,order_id,kind,product_id,scheduling_required_pyg,collection_required_pyg,actor,note)
    VALUES($1,$2,'REQUIREMENT',$3,0,0,'ADMIN','Synthetic existing gift exception')`, [randomUUID(), f.order.id, f.order.items[0].productId]);
  const before = await state();
  assert.equal((await handler(request(approved(f)))).status, 200);
  assert.deepEqual(await state(), before);
  assert.equal((await events(f))[0].context.paymentEvidenceBypassed, true);
});

test('internal authorization also requires a trusted OWNER actor', async () => {
  const f = await fixture();
  for (const context of [{}, { actor: 'REVIEWER' }]) {
    await assert.rejects(mutateFulfillmentBatch(approved(f), context), e => e.status === 403);
  }
  assert.deepEqual(await events(f), []);
});

for (const value of [{ confirmed: false, reason: 'x' }, { confirmed: 'true', reason: 'x' },
  { confirmed: true, reason: '  ' }, { confirmed: true, reason: 'x'.repeat(501) }, { confirmed: true, reason: 12 }, false]) {
  test('invalid authorization fails before delivery: ' + JSON.stringify(value).slice(0,65), async () => {
    const f = await fixture();
    assert.equal((await handler(request(deliver(f, { ownerDeliveryAuthorization: value })))).status, 400);
    assert.deepEqual(await events(f), []);
  });
}

for (const change of ["order_snapshot=jsonb_set(order_snapshot,'{status}','\"CANCELLED\"')",
  "order_snapshot=jsonb_set(order_snapshot,'{reservationState}','\"EXPIRED\"')", 'committed_at=NULL',
  "order_snapshot=jsonb_set(order_snapshot,'{items}','[]')"]) {
  test('OWNER cannot bypass order/inventory/membership protection: ' + change, async () => {
    const f = await fixture();
    await db.query(`UPDATE checkout_attempts SET ${change} WHERE order_id=$1`, [f.order.id]);
    const before = await state();
    const response = await handler(request(approved(f)));
    assert.equal(response.status, 409);
    assert.notEqual((await response.json()).code, 'DELIVERY_PAYMENT_EVIDENCE_REQUIRED');
    assert.deepEqual(await state(), before); assert.deepEqual(await events(f), []);
  });
}

for (const status of ['OPEN', 'DELIVERED', 'CLOSED_OWNER_WITHDRAWAL']) test('OWNER cannot deliver a ' + status + ' batch', async () => {
  const f = await fixture(db, { state: status });
  assert.equal((await handler(request(approved(f)))).status, 409); assert.deepEqual(await events(f), []);
});

test('stale revisions, merged batches and nonexistent orders remain blocked', async () => {
  const f = await fixture();
  assert.equal((await handler(request(approved(f, { expectedRevision: 9 })))).status, 409);
  const other = await fixture();
  await db.query('UPDATE fulfillment_batches SET merged_into_batch_id=$2 WHERE fulfillment_batch_id=$1', [f.batchId, other.batchId]);
  assert.equal((await handler(request(approved(f)))).status, 409); assert.deepEqual(await events(f), []);
  const g = await fixture();
  const client = { query: (sql, params) => sql.includes('SELECT * FROM checkout_attempts') ? { rows: [] } : db.query(sql, params) };
  await assert.rejects(transitionBatch(client, approved(g), owner), e => e.code === 'FULFILLMENT_ORDER_INELIGIBLE');
});

test('explicit historical confirmation keeps its separate existing behavior', async () => {
  const f = await fixture(db, { state: 'LEGACY_FROZEN' });
  assert.equal((await handler(request(deliver(f)))).status, 409);
  assert.equal((await handler(request(deliver(f, { confirmFrozen: true })))).status, 200);
  assert.deepEqual((await events(f))[0].context, { reason: 'HISTORICAL_DELIVERY_CONFIRMED' });
});

test('delivery never repairs unrelated assignments or changes uncommitted orders', async () => {
  const protectedOrder = await fixture(db, { assigned: false });
  await db.query('UPDATE checkout_attempts SET committed_at=NULL WHERE order_id=$1', [protectedOrder.order.id]);
  const unrelated = await fixture(db, { assigned: false });
  const f = await fixture(), before = await state();
  const unrelatedBatches = (await db.query('SELECT * FROM fulfillment_batches WHERE fulfillment_batch_id<>$1 ORDER BY fulfillment_batch_id', [f.batchId])).rows;
  assert.equal((await handler(request(approved(f)))).status, 200);
  assert.deepEqual(await state(), before);
  assert.deepEqual((await db.query('SELECT * FROM fulfillment_batches WHERE fulfillment_batch_id<>$1 ORDER BY fulfillment_batch_id', [f.batchId])).rows, unrelatedBatches);
  for (const o of [protectedOrder, unrelated]) assert.deepEqual((await db.query('SELECT * FROM buyer_group_orders WHERE order_id=$1', [o.order.id])).rows, []);
});

test('correction lifecycle blocks premature delivery but permits only committed Item 369 afterward', async () => {
  // Synthetic records only: model PR #86's pre/postconditions without executing
  // its correction or changing any of that PR's code.
  const f = await fixture(db, { orderId: 'VM-2026-96200FE0' });
  await db.query('UPDATE checkout_attempts SET committed_at=NULL WHERE order_id=$1', [f.order.id]);
  let before = await state();
  const premature = await handler(request(approved(f)));
  assert.equal(premature.status, 409);
  assert.equal((await premature.json()).code, 'FULFILLMENT_ORDER_INELIGIBLE');
  assert.deepEqual(await state(), before); assert.deepEqual(await events(f), []);

  // The actual pre-correction order has no membership. Delivery cannot create
  // membership for it, and an empty persisted batch cannot be delivered.
  await db.query('DELETE FROM fulfillment_batch_items WHERE order_id=$1', [f.order.id]);
  before = await state();
  assert.equal((await handler(request(approved(f)))).status, 409);
  assert.deepEqual(await state(), before); assert.deepEqual(await events(f), []);

  const kept = { ...f.order.items[0], productId: 'real-202610-volume4-369', itemNumber: 369,
    unitPricePYG: 30000, dueNowPYG: 30000, futureBalancePYG: 0 };
  const corrected = { ...f.order, items: [kept], totals: { totalPYG: 30000, dueNowPYG: 30000, futureBalancePYG: 0 },
    payments: f.order.payments.map(p => ({ ...p, amountPYG: 30000, amountSource: 'ADMIN_VERIFIED' })) };
  await db.query('UPDATE checkout_attempts SET committed_at=clock_timestamp(),order_snapshot=$2 WHERE order_id=$1', [f.order.id, JSON.stringify(corrected)]);
  await db.query('DELETE FROM inventory_reservations WHERE order_id=$1', [f.order.id]);
  await db.query('UPDATE operational_inventory SET committed_quantity=0 WHERE product_id=ANY($1::text[])', [f.order.items.map(i => i.productId)]);
  await db.query('INSERT INTO operational_inventory(product_id,capacity,committed_quantity) VALUES($1,1,1)', [kept.productId]);
  await db.query("INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,order_id) VALUES($1,$2,1,'COMMITTED',$3)", [kept.productId, f.session, f.order.id]);

  // Even after commitment, delivery cannot manufacture an assignment. Once the
  // normal assignment/preparation workflow provides Item 369, it can be delivered.
  assert.equal((await handler(request(deliver(f)))).status, 409);
  await db.query("INSERT INTO fulfillment_batch_items(order_id,product_id,fulfillment_batch_id,assignment_mode) VALUES($1,$2,$3,'AUTO_NEW')", [f.order.id, f.order.items[1].productId, f.batchId]);
  before = await state();
  const removedItem = await handler(request(approved(f)));
  assert.equal(removedItem.status, 409);
  assert.equal((await removedItem.json()).code, 'FULFILLMENT_ITEMS_NOT_FOUND');
  assert.deepEqual(await state(), before); assert.deepEqual(await events(f), []);
  await db.query('DELETE FROM fulfillment_batch_items WHERE order_id=$1', [f.order.id]);
  await db.query("INSERT INTO fulfillment_batch_items(order_id,product_id,fulfillment_batch_id,assignment_mode) VALUES($1,$2,$3,'AUTO_NEW')", [f.order.id, kept.productId, f.batchId]);
  before = await state();
  const delivered = await handler(request(deliver(f)));
  assert.equal(delivered.status, 200);
  assert.deepEqual((await delivered.json()).changedBatches[0].items.map(i => i.productId), [kept.productId]);
  const [event] = await events(f);
  assert.deepEqual(event.affected_items, [{ orderId: f.order.id, productId: kept.productId }]);
  assert.deepEqual(event.context, {}, 'verified full payment needs no owner override');
  assert.deepEqual(await state(), before, 'delivery preserves the corrected snapshot, financial evidence and inventory');
});

test('audit failure rolls back the delivery and retry writes exactly one event', async () => {
  const f = await fixture(), before = await state();
  setInventoryDatabaseClientForTests({ pool: { connect: async () => ({ release() {}, query(sql, params) {
    if (sql.includes('INSERT INTO fulfillment_batch_events')) throw new Error('synthetic audit failure');
    return db.query(sql, params);
  } }) } });
  try { await assert.rejects(mutateFulfillmentBatch(approved(f), owner), /synthetic audit failure/); }
  finally { setInventoryDatabaseClientForTests({ pool: poolFor(db) }); }
  assert.equal((await db.query('SELECT status FROM fulfillment_batches WHERE fulfillment_batch_id=$1', [f.batchId])).rows[0].status, 'PREPARED');
  assert.deepEqual(await state(), before); assert.deepEqual(await events(f), []);
  await mutateFulfillmentBatch(approved(f), owner); assert.equal((await events(f)).length, 1);
});

const connectionString = process.env.PICKUP_TEST_DATABASE_URL;
test('independent SQL workers serialize duplicate authorization and recheck a concurrent cancellation', { skip: !connectionString }, async () => {
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)); assert.match(url.pathname, /^\/pickup_test_[a-z0-9_]+$/);
  const control = new pg.Pool({ connectionString }), schema = 'delivery_test_' + randomUUID().replaceAll('-', '');
  let pool;
  try {
    await control.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString, max: 5, options: `-c search_path=${schema}` });
    await migrateRetentionFixture(pool);
    setInventoryDatabaseClientForTests({ pool });
    const f = await fixture(pool), before = await state(pool);
    const result = await Promise.allSettled([mutateFulfillmentBatch(approved(f), owner), mutateFulfillmentBatch(approved(f), owner)]);
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(result.filter(r => r.status === 'rejected' && r.reason.code === 'FULFILLMENT_REVISION_CONFLICT').length, 1);
    assert.equal((await events(f, pool)).length, 1); assert.deepEqual(await state(pool), before);
    const g = await fixture(pool), blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query("UPDATE checkout_attempts SET order_snapshot=jsonb_set(order_snapshot,'{status}','\"CANCELLED\"') WHERE order_id=$1", [g.order.id]);
    let reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    const direct = await pool.connect();
    const delivery = (async () => {
      try {
        await direct.query('BEGIN');
        const wrapper = { query(sql, params) { if (sql.includes('SELECT * FROM checkout_attempts')) reached(); return direct.query(sql, params); } };
        const value = await transitionBatch(wrapper, approved(g), owner); await direct.query('COMMIT'); return value;
      } catch (error) { await direct.query('ROLLBACK'); throw error; }
      finally { direct.release(); }
    })();
    const rejected = assert.rejects(delivery, e => e.code === 'FULFILLMENT_ORDER_INELIGIBLE');
    await waiting; await blocker.query('COMMIT'); blocker.release(); await rejected;
    assert.deepEqual(await events(g, pool), []);
  } finally {
    setInventoryDatabaseClientForTests({ pool: poolFor(db) });
    if (pool) await pool.end(); await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await control.end();
  }
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} confirmation requires reason, supports cancel, and sends the original revision`, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
    const f = await fixture(), posts = [], dialogs = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).pathname === '/harness') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><main>Isolated delivery test</main>' });
      if (new URL(route.request().url()).pathname !== '/api/admin/fulfillment-batches') return route.abort();
      const body = route.request().postDataJSON(); posts.push(body);
      const response = await handler(request(body));
      return route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
    await page.goto(origin + '/harness');
    await page.addScriptTag({ content: await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8') });
    await page.evaluate(f => { ADMIN_STATE.fulfillmentBatches = [{ fulfillmentBatchId: f.batchId, status: 'PREPARED', revision: 1, items: f.order.items }]; renderBuyerSheetsTab = () => {}; }, f);
    let cancel = true;
    page.on('dialog', async dialog => {
      dialogs.push(dialog.message());
      if (dialog.type() === 'prompt') return cancel ? dialog.dismiss() : dialog.accept(authorization.reason);
      await dialog.accept();
    });
    await page.evaluate(id => deliverFulfillmentBatch(id), f.batchId);
    assert.equal(posts.length, 1); assert.deepEqual(await events(f), []);
    cancel = false;
    await page.evaluate(id => deliverFulfillmentBatch(id), f.batchId);
    assert.equal(posts.length, 3); assert.equal(posts[2].expectedRevision, 1);
    assert.deepEqual(posts[2].ownerDeliveryAuthorization, authorization);
    assert.ok(dialogs.some(s => s.includes('Autorizar entrega como propietario')));
    assert.equal((await events(f)).length, 1); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
