import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { changePickup, pickupFulfillments } from './pickup.mjs';
import { appendItemPaymentDecision } from './item-payment-decisions.mjs';
import { setInventoryDatabaseClientForTests } from './inventory-database.mjs';
import { requirePickupWrites, readPickupWriteControl, setPickupWriteControl } from './pickup-write-control.mjs';
import containmentHandler from '../admin-pickup-containment.mjs';
import customerPickup from '../customer-pickup.mjs';
import adminPickup from '../admin-pickup.mjs';
import itemPayment from '../admin-item-payment.mjs';

const connectionString = process.env.PICKUP_TEST_DATABASE_URL;
let control, pool, schema, legacyOrder;
const originalToken = process.env.ADMIN_TOKEN;
const slot = '2026-11-15|10:00-11:00';
const pauseInput = (paused, expectedRevision) => ({ id: randomUUID(), paused, expectedRevision, reason: 'Isolated containment verification' });
const transaction = async operation => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};
const book = orderId => changePickup({ orderId, timingKey: 'IMMEDIATE', slotKey: slot, actor: 'CUSTOMER', itemIds: ['a'] },
  { slotKeys: () => [slot], queueNotifications: async () => {} });
const request = (path, body, token = 'isolated-owner') => new Request(`https://isolated.test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token }, body: JSON.stringify(body) });
const snapshot = async () => Object.fromEntries(await Promise.all(['checkout_attempts', 'operational_inventory', 'inventory_reservations',
  'pickup_appointments', 'item_payment_decisions', 'seller_notifications'].map(async table => [table, (await pool.query(`SELECT * FROM ${table}`)).rows])));
async function fixture(appointment = false) {
  const id = `ISOLATED-${randomUUID()}`, session = randomUUID();
  const order = { id, status: 'PAYMENT_CONFIRMED', reservationState: 'PROTECTED', buyer: { name: 'Synthetic', phone: '000' },
    items: [{ productId: 'a', itemNumber: 546, quantity: 1, saleMode: 'IMMEDIATE', unitPricePYG: 100, dueNowPYG: 100, futureBalancePYG: 0 }],
    totals: { totalPYG: 100, dueNowPYG: 100, futureBalancePYG: 0 }, paymentAdjustments: [],
    payments: [{ id: 'paid', amountPYG: 100, amountSource: 'ADMIN_VERIFIED', verifiedBy: 'ADMIN', verificationStatus: 'CONFIRMED' }] };
  await pool.query('INSERT INTO cart_sessions(session_id) VALUES($1)', [session]);
  await pool.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,committed_at)
    VALUES($1,$2,$3,0,'synthetic',$4,clock_timestamp())`, [id, session, randomUUID(), JSON.stringify(order)]);
  if (appointment) await pool.query('INSERT INTO pickup_windows(slot_key) VALUES($1) ON CONFLICT DO NOTHING', [slot]);
  if (appointment) await pool.query(`INSERT INTO pickup_appointments(order_id,timing_key,slot_key,status,changed_by,revision)
    VALUES($1,'IMMEDIATE',$2,'SCHEDULED','ADMIN',3)`, [id, slot]);
  return order;
}
async function toggle(paused) { const current = await readPickupWriteControl(); return setPickupWriteControl(pauseInput(paused, current.revision)); }
async function waitForLock(fragment) {
  const limit = Date.now() + 3000;
  while (Date.now() < limit) {
    const result = await control.query(`SELECT count(*)::int n FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1`, [`%${fragment}%`]);
    if (result.rows[0].n) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`No independent worker waited on ${fragment}`);
}
function heldTransaction() {
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const safety = setTimeout(() => release(), 10000);
  gate.then(() => clearTimeout(safety));
  return { ready, release, run: operation => transaction(async client => { const result = await operation(client); entered(); await gate; return result; }) };
}

test.before(async () => {
  if (!connectionString) return;
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/pickup_test_[a-z0-9_]+$/);
  control = new pg.Pool({ connectionString }); schema = `pickup_containment_${randomUUID().replaceAll('-', '')}`;
  await control.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({ connectionString, max: 12, options: `-c search_path=${schema}` });
  for (const name of ['20261001_operational_inventory', '20261005_pickup_notifications', '20261006_notification_recipients',
    '20261010_pickup_fulfillment_parts', '20261102_pickup_blackouts', '20261114_item_payment_pickup']) {
    await pool.query(await readFile(new URL(`../../database/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  legacyOrder = await fixture(true);
  const beforeMigration = await snapshot();
  await pool.query(await readFile(new URL('../../database/migrations/20261115_pickup_containment.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await snapshot(), beforeMigration, 'additive migration preserves every existing business record');
  setInventoryDatabaseClientForTests({ pool }); process.env.ADMIN_TOKEN = 'isolated-owner';
});
test.after(async () => {
  setInventoryDatabaseClientForTests(undefined);
  if (originalToken === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = originalToken;
  await pool?.end(); if (schema) await control.query(`DROP SCHEMA ${schema} CASCADE`); await control?.end();
});

test('additive migration starts paused; stale aliases/direct calls fail closed and preserve legacy appointment and financial evidence', { skip: !connectionString }, async () => {
  const order = legacyOrder, before = await snapshot();
  assert.equal((await readPickupWriteControl()).paused, true);
  for (const actor of ['ADMIN', 'CUSTOMER']) for (const slotKey of [slot, null]) {
    await assert.rejects(changePickup({ orderId: order.id, timingKey: 'IMMEDIATE', slotKey, actor }), e => e.status === 503);
  }
  for (const kind of ['ALLOCATE', 'REVERSE', 'REQUIREMENT', 'REVOKE']) {
    await assert.rejects(appendItemPaymentDecision(order.id, { kind }), e => e.status === 503);
  }
  for (const [handler, aliases] of [[customerPickup, ['/api/orders/pickup', '/.netlify/functions/customer-pickup']],
    [adminPickup, ['/api/admin/pickup', '/.netlify/functions/admin-pickup']], [itemPayment, ['/api/admin/item-payment', '/.netlify/functions/admin-item-payment']]]) {
    for (const path of aliases) assert.equal((await handler(request(path, { orderId: order.id, timingKey: 'IMMEDIATE', slotKey: slot }))).status, 503);
  }
  const [part] = await pickupFulfillments(order);
  assert.equal(part.schedulingEligible, true); assert.equal(part.writesPaused, true); assert.deepEqual(part.slots, []);
  assert.equal(part.appointment.revision, 3); assert.equal(part.appointment.itemIds, null);
  assert.deepEqual(await snapshot(), before);
  for (const path of ['/api/admin/pickup-containment', '/.netlify/functions/admin-pickup-containment']) {
    assert.equal((await containmentHandler(request(path, pauseInput(false, 1), 'wrong'))).status, 401);
  }
});

test('pause waits for an actual booking commit; stale requests after acknowledgement are rejected; resume recovers', { skip: !connectionString }, async () => {
  await toggle(false); const first = await fixture(), second = await fixture(), held = heldTransaction();
  const writer = changePickup({ orderId: first.id, timingKey: 'IMMEDIATE', slotKey: slot, actor: 'ADMIN', itemIds: ['a'] },
    { transaction: held.run, slotKeys: () => [slot], queueNotifications: async () => {} });
  await held.ready;
  let acknowledged = false;
  const pause = toggle(true).then(result => { acknowledged = true; return result; });
  await waitForLock('pickup_write_control WHERE singleton=true FOR UPDATE'); assert.equal(acknowledged, false);
  held.release(); await writer; const result = await pause;
  assert.equal(result.state.paused, true);
  assert.equal((await pool.query('SELECT revision FROM pickup_appointments WHERE order_id=$1', [first.id])).rows.length, 1);
  assert.equal((await pool.query('SELECT * FROM pickup_appointments WHERE order_id=$1', [second.id])).rows.length, 0);
  await assert.rejects(book(second.id), e => e.status === 503);
  await toggle(false); assert.equal((await book(second.id)).status, 'SCHEDULED');
});

test('a request waiting on the uncommitted pause sees the new state and is rejected', { skip: !connectionString }, async () => {
  await toggle(false); const order = await fixture(), held = heldTransaction();
  const current = await readPickupWriteControl();
  const pause = setPickupWriteControl(pauseInput(true, current.revision), { transaction: held.run });
  await held.ready;
  const stale = assert.rejects(book(order.id), e => e.status === 503);
  await waitForLock('pickup_write_control WHERE singleton=true FOR SHARE');
  held.release(); await pause; await stale;
  assert.equal((await pool.query('SELECT * FROM pickup_appointments WHERE order_id=$1', [order.id])).rows.length, 0);
});

for (const kind of ['ALLOCATE', 'REQUIREMENT']) test(`pause drains an actual ${kind} decision transaction and blocks later ledger writes without rewriting evidence`, { skip: !connectionString }, async () => {
  await toggle(false); const order = await fixture(), held = heldTransaction();
  const decision = appendItemPaymentDecision(order.id, { kind, productId: 'a', paymentId: 'paid', amountPYG: 100, schedulingRequiredPYG: 100,
    collectionRequiredPYG: 100, note: 'Synthetic explicit existing agreement' }, { transaction: held.run });
  await held.ready; const pause = toggle(true); await waitForLock('pickup_write_control WHERE singleton=true FOR UPDATE');
  held.release(); const event = await decision; await pause;
  const before = await snapshot();
  await assert.rejects(appendItemPaymentDecision(order.id, { kind: kind === 'ALLOCATE' ? 'REVERSE' : 'REVOKE', reversesId: event.id, note: 'Stale request' }), e => e.status === 503);
  assert.deepEqual(await snapshot(), before);
});

test('lock timeout never acknowledges pause or creates audit evidence; retry is explicit', { skip: !connectionString }, async () => {
  await toggle(false); const before = await readPickupWriteControl(), blocker = await pool.connect();
  try {
    await blocker.query('BEGIN'); await requirePickupWrites(blocker, { lock: true });
    await assert.rejects(setPickupWriteControl(pauseInput(true, before.revision)), e => e.status === 409 && /No se confirmó/.test(e.message));
    assert.deepEqual(await readPickupWriteControl(), before);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  assert.equal((await toggle(true)).state.paused, true);
});

test('competing controls serialize; stale resume cannot undo a later pause; retries are idempotent and audit evidence cannot be edited', { skip: !connectionString }, async () => {
  const current = await readPickupWriteControl(), input = pauseInput(false, current.revision);
  const results = await Promise.allSettled([setPickupWriteControl(input), setPickupWriteControl(pauseInput(true, current.revision))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  // A lost resume response retried after a newer pause returns CURRENT paused state.
  const opened = await toggle(false), retry = { id: opened.event.id, paused: false, expectedRevision: opened.event.previous_revision, reason: opened.event.reason };
  const paused = await toggle(true), replay = await setPickupWriteControl(retry);
  assert.equal(replay.replayed, true); assert.equal(replay.state.revision, paused.state.revision); assert.equal(replay.state.paused, true);
  await assert.rejects(setPickupWriteControl({ ...retry, id: randomUUID() }), e => e.status === 409);
  await assert.rejects(setPickupWriteControl({ ...retry, reason: 'Changed payload' }), e => e.status === 409);
  for (const sql of ['UPDATE pickup_write_control_events SET reason=reason', 'DELETE FROM pickup_write_control_events', 'TRUNCATE pickup_write_control_events',
    'DELETE FROM pickup_write_control', 'TRUNCATE pickup_write_control']) await assert.rejects(pool.query(sql));
});

test('missing switch fails closed for target writes while order/appointment reads remain available', { skip: !connectionString }, async () => {
  const order = await fixture(true), before = await snapshot();
  await pool.query('ALTER TABLE pickup_write_control RENAME TO hidden_pickup_control');
  try {
    await assert.rejects(book(order.id), e => e.status === 503);
    await assert.rejects(appendItemPaymentDecision(order.id, { kind: 'ALLOCATE' }), e => e.status === 503);
    const [part] = await pickupFulfillments(order); assert.equal(part.writesPaused, true); assert.equal(part.appointment.revision, 3);
    assert.deepEqual(await snapshot(), before);
  } finally { await pool.query('ALTER TABLE hidden_pickup_control RENAME TO pickup_write_control'); }
});
