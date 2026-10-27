import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { changePickup } from './pickup.mjs';
import { setInventoryDatabaseClientForTests } from './inventory-database.mjs';
import { drainSellerNotifications } from './seller-notifications.mjs';

// Optional real PostgreSQL coverage for row blocking and independent workers.
// Run with PICKUP_TEST_DATABASE_URL pointing to an expendable local database
// whose name starts with pickup_test_. Never accept a hosted/operational DB.
const connectionString = process.env.PICKUP_TEST_DATABASE_URL;
let pool, control, schema;
const originalFetch = globalThis.fetch;
const envKeys = ['SELLER_NOTIFICATION_TO', 'SELLER_NOTIFICATION_FROM', 'RESEND_API_KEY'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const day = '2026-11-02';
const hourly = `${day}|08:00-09:00`;
const legacy = `${day}|08:00-12:00`;

test.before(async () => {
  if (!connectionString) return;
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/pickup_test_[a-z0-9_]+$/);
  control = new pg.Pool({ connectionString });
  schema = `pickup_test_${randomUUID().replaceAll('-', '')}`;
  await control.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({ connectionString, max: 12, options: `-c search_path=${schema}` });
  for (const migration of ['20261001_operational_inventory', '20261005_pickup_notifications',
    '20261006_notification_recipients', '20261010_pickup_fulfillment_parts']) {
    await pool.query(await readFile(new URL(`../../database/migrations/${migration}.sql`, import.meta.url), 'utf8'));
  }
  setInventoryDatabaseClientForTests({ pool });
});

test.beforeEach(async () => {
  if (pool) await pool.query('TRUNCATE cart_sessions CASCADE');
  process.env.SELLER_NOTIFICATION_TO = 'seller@example.com';
  process.env.SELLER_NOTIFICATION_FROM = 'test@example.com';
  process.env.RESEND_API_KEY = 'mock-key';
  globalThis.fetch = async () => { throw new Error('Unexpected external request'); };
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  setInventoryDatabaseClientForTests(undefined);
  await pool?.end();
  if (schema) await control.query(`DROP SCHEMA ${schema} CASCADE`);
  await control?.end();
});

async function fixture(slotKey) {
  const id = `VM-SYNTHETIC-${randomUUID()}`;
  const session = randomUUID();
  const order = { id, buyer: { name: 'Synthetic', phone: '+595 000' }, status: 'PAYMENT_CONFIRMED',
    totals: { totalPYG: 100, dueNowPYG: 100, futureBalancePYG: 0 },
    items: [{ productId: 'synthetic', saleMode: 'IMMEDIATE', quantity: 1, unitPricePYG: 100, dueNowPYG: 100 }],
    payments: [{ id: 'paid', type: 'FULL', amountPYG: 100, amountSource: 'ADMIN_VERIFIED',
      verifiedBy: 'ADMIN', verificationStatus: 'CONFIRMED' }], paymentAdjustments: [] };
  await pool.query('INSERT INTO cart_sessions(session_id) VALUES($1)', [session]);
  await pool.query(`INSERT INTO checkout_attempts(session_id,checkout_id,order_id,order_snapshot,cart_generation,request_fingerprint)
    VALUES($1,$2,$3,$4,0,'synthetic')`,
    [session, randomUUID(), id, JSON.stringify(order)]);
  if (slotKey) {
    await pool.query('INSERT INTO pickup_windows(slot_key) VALUES($1) ON CONFLICT DO NOTHING', [slotKey]);
    await pool.query(`INSERT INTO pickup_appointments(order_id,timing_key,slot_key,status,changed_by)
      VALUES($1,'IMMEDIATE',$2,'SCHEDULED','ADMIN')`, [id, slotKey]);
  }
  return id;
}

const change = (id, slotKey, dependencies) => changePickup({ orderId: id, timingKey: 'IMMEDIATE',
  slotKey, actor: 'ADMIN' }, dependencies);
const notices = async () => (await pool.query('SELECT * FROM seller_notifications ORDER BY event_key')).rows;

test('simultaneous hourly requests cannot exceed four overlapping appointments', { skip: !connectionString }, async () => {
  for (let i = 0; i < 3; i++) await fixture(legacy);
  const buyers = await Promise.all(Array.from({ length: 8 }, () => fixture()));
  const attempts = await Promise.allSettled(buyers.map(id => change(id, hourly)));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(attempts.filter(r => r.status === 'rejected').every(r => r.reason.status === 409));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM pickup_appointments WHERE status='SCHEDULED'")).rows[0].n, 4);
  assert.equal((await notices()).length, 2);
});

test('different overlapping legacy/hourly keys share the date lock', { skip: !connectionString }, async () => {
  for (let i = 0; i < 3; i++) await fixture(legacy);
  const [first, second] = await Promise.all([fixture(), fixture()]);
  // Exercise the transaction's compatibility boundary with a legacy writer:
  // different slot rows must still serialize against the same date row.
  const attempts = await Promise.allSettled([
    change(first, legacy, { slotKeys: () => [legacy] }), change(second, hourly),
  ]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal((await notices()).length, 2);
});

test('simultaneous retries of one appointment produce one revision and exactly two messages', { skip: !connectionString }, async () => {
  const buyer = await fixture();
  const attempts = await Promise.all(Array.from({ length: 6 }, () => change(buyer, hourly)));
  assert.ok(attempts.every(a => a.revision === 1 && a.slotKey === hourly));
  assert.equal((await notices()).length, 2);
});

test('opposite date moves commit without deadlocks and preserve both appointments', { skip: !connectionString }, async () => {
  const next = '2026-11-03|08:00-09:00';
  const [first, second] = await Promise.all([fixture(hourly), fixture(next)]);
  const results = await Promise.all([change(first, next), change(second, hourly)]);
  assert.deepEqual(results.map(a => a.slotKey), [next, hourly]);
  assert.ok(results.every(a => a.revision === 2));
  assert.equal((await notices()).length, 4);
});

test('independent notification workers claim each ready/agenda email once', { skip: !connectionString }, async () => {
  const buyer = await fixture();
  await change(buyer, hourly);
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push({ ...JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
    return new Response(JSON.stringify({ id: 'mock-id' }));
  };
  await Promise.all([drainSellerNotifications(4), drainSellerNotifications(4), drainSellerNotifications(4)]);
  assert.equal(calls.length, 2);
  assert.equal(new Set(calls.map(c => c.key)).size, 2);
  assert.ok(calls.every(c => c.to.length === 1 && c.to[0] === 'seller@example.com'));
  assert.ok((await notices()).every(row => row.status === 'SENT' && row.attempts === 1));
});
