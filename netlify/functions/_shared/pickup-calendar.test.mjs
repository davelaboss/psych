import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { blackoutInput, changePickupBlackout, readPickupCalendar, pickupBaseRanges } from './pickup-calendar.mjs';
import { changePickup, pickupAvailability, pickupSlotKeys, listUpcomingPickups } from './pickup.mjs';
import { setInventoryDatabaseClientForTests } from './inventory-database.mjs';
import { createPickupCalendarHandler } from '../admin-pickup-calendar.mjs';

let db;
const date = '2026-12-01', slot = `${date}|09:00-10:00`;
const clock = Date.parse('2026-11-01T12:00:00Z');
test.before(async () => {
  db = new PGlite();
  for (const name of ['20261001_operational_inventory', '20261005_pickup_notifications',
    '20261006_notification_recipients', '20261010_pickup_fulfillment_parts', '20261102_pickup_blackouts']) {
    await db.exec(await readFile(new URL(`../../database/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  setInventoryDatabaseClientForTests({ pool: { query: (...args) => db.query(...args),
    connect: async () => ({ query: (...args) => db.query(...args), release() {} }) } });
});
test.beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: clock }));
test.beforeEach(async () => { await db.exec('TRUNCATE cart_sessions,pickup_blackouts,pickup_windows CASCADE'); });
test.after(async () => { setInventoryDatabaseClientForTests(undefined); await db.close(); });

async function fixture(slotKey, { legacy = false, name = 'Comprador sintético' } = {}) {
  const id = `VM-SYNTHETIC-${randomUUID()}`, session = randomUUID();
  const order = { id, status: 'PAID_IN_FULL', buyer: { name, phone: '+595 000 123' },
    totals: { totalPYG: 100, dueNowPYG: 100, futureBalancePYG: 0 },
    items: [{ productId: 'synthetic', itemNumber: 381, quantity: 1, saleMode: 'IMMEDIATE', unitPricePYG: 100, dueNowPYG: 100 }],
    payments: [{ id: 'paid', type: 'FULL', amountPYG: 100, amountSource: 'ADMIN_VERIFIED',
      verifiedBy: 'ADMIN', verificationStatus: 'CONFIRMED' }], paymentAdjustments: [] };
  await db.query('INSERT INTO cart_sessions(session_id) VALUES($1)', [session]);
  await db.query(`INSERT INTO checkout_attempts(session_id,checkout_id,order_id,order_snapshot,cart_generation,request_fingerprint)
    VALUES($1,$2,$3,$4,0,'synthetic')`, [session, randomUUID(), id, JSON.stringify(order)]);
  if (slotKey) {
    const key = legacy ? `${date}|08:00-12:00` : slotKey;
    await db.query('INSERT INTO pickup_windows(slot_key) VALUES($1) ON CONFLICT DO NOTHING', [key]);
    await db.query(`INSERT INTO pickup_appointments(order_id,timing_key,slot_key,status,changed_by)
      VALUES($1,'IMMEDIATE',$2,'SCHEDULED','ADMIN')`, [id, key]);
  }
  return order;
}
const draft = extra => ({ date, start: '09:30', end: '10:30', reason: 'Motivo privado sintético', ...extra });
async function save(body) {
  const review = await changePickupBlackout({ ...body, action: 'preview' });
  return changePickupBlackout({ ...body, action: 'save', reviewToken: review.reviewToken });
}
const book = (order, key = slot) => changePickup({ orderId: order.id, timingKey: 'IMMEDIATE', slotKey: key, actor: 'CUSTOMER' });

test('the four December overrides alone open 08–20; all eligibility boundaries are preserved', async () => {
  for (const day of ['2026-12-01', '2026-12-05', '2026-12-08', '2026-12-12']) assert.deepEqual(pickupBaseRanges(day), [['08:00', '20:00']]);
  assert.deepEqual(pickupBaseRanges('2026-11-03'), [['08:00', '12:00'], ['13:00', '16:00']]);
  assert.deepEqual(pickupBaseRanges('2026-11-07'), [['14:00', '17:00']]);
  const order = await fixture();
  const immediate = pickupSlotKeys(order, 'IMMEDIATE', '2026-11-01', '00:00');
  assert.equal(immediate.filter(k => k.startsWith('2026-12-08|')).length, 12);
  assert.ok(immediate.every(k => k.slice(0, 10) <= '2026-12-08'));
  const delayed = { ...order, items: [{ ...order.items[0], saleMode: 'DELAYED', pickupWindowStart: '2026-12-01', pickupWindowEnd: '2026-12-20' }] };
  const keys = pickupSlotKeys(delayed, 'DELAYED:2026-12-01:2026-12-20', '2026-11-01', '00:00');
  assert.deepEqual([...new Set(keys.map(k => k.slice(0, 10)))], ['2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12']);
  const narrow = { ...order, items: [{ ...order.items[0], saleMode: 'DELAYED', pickupWindowStart: '2026-12-10', pickupWindowEnd: '2026-12-11' }] };
  assert.deepEqual([...new Set(pickupSlotKeys(narrow, 'DELAYED:2026-12-10:2026-12-11', '2026-11-01', '00:00').map(k => k.slice(0, 10)))], ['2026-12-10', '2026-12-11']);
});

test('preview identifies every affected buyer and legacy overlap without changing any appointment or financial record', async () => {
  await fixture(slot, { name: '<David & María>' }); await fixture(slot, { legacy: true });
  await fixture(`${date}|10:30-11:30`); // exact end boundary is not overlapping
  const before = (await db.query('SELECT * FROM pickup_appointments ORDER BY order_id')).rows;
  const orders = (await db.query('SELECT * FROM checkout_attempts ORDER BY order_id')).rows;
  const review = await changePickupBlackout(draft({ action: 'preview' }));
  assert.equal(review.conflicts.length, 2);
  for (const a of review.conflicts) {
    assert.ok(a.buyer); assert.ok(a.buyerPhone); assert.deepEqual(a.itemNumbers, [381]); assert.match(a.orderId, /^VM-SYNTHETIC/);
  }
  assert.equal((await db.query('SELECT * FROM pickup_blackouts')).rows.length, 0);
  await changePickupBlackout(draft({ action: 'save', reviewToken: review.reviewToken }));
  assert.deepEqual((await db.query('SELECT * FROM pickup_appointments ORDER BY order_id')).rows, before);
  assert.deepEqual((await db.query('SELECT * FROM checkout_attempts ORDER BY order_id')).rows, orders);
  assert.equal((await db.query('SELECT * FROM seller_notifications')).rows.length, 0);
  const calendar = await readPickupCalendar('2026-12', db);
  assert.equal(calendar.appointments.filter(a => a.needsReschedule).length, 2);
  assert.equal((await listUpcomingPickups({ client: db, now: new Date(clock) })).filter(a => a.needsReschedule).length, 2);
});

test('a booking between preview and confirmation forces review of the new actual buyer', async () => {
  const review = await changePickupBlackout(draft({ action: 'preview' }));
  const order = await fixture(); await book(order);
  const stale = await changePickupBlackout(draft({ action: 'save', reviewToken: review.reviewToken }));
  assert.equal(stale.saved, false); assert.equal(stale.conflicts[0].orderId, order.id);
  assert.notEqual(stale.reviewToken, review.reviewToken);
  assert.equal((await db.query('SELECT * FROM pickup_blackouts')).rows.length, 0);
  assert.equal((await changePickupBlackout(draft({ action: 'save', reviewToken: stale.reviewToken }))).saved, true);
});

test('display and both booking actors reject partial overlap; boundary-adjacent and existing appointments survive', async () => {
  const existing = await fixture(slot); const order = await fixture(); await save(draft());
  const available = await pickupAvailability(order, 'IMMEDIATE');
  assert.ok(!available.some(s => s.key === slot || s.key === `${date}|10:00-11:00`));
  assert.ok(available.some(s => s.key === `${date}|08:00-09:00`));
  for (const actor of ['ADMIN', 'CUSTOMER']) await assert.rejects(changePickup({ orderId: order.id, timingKey: 'IMMEDIATE', slotKey: slot, actor }), /bloqueado/);
  assert.equal((await book(existing)).slotKey, slot); // idempotent original remains confirmed
  assert.equal((await book(order, `${date}|11:00-12:00`)).status, 'SCHEDULED');
  const before = (await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1', [order.id])).rows;
  await assert.rejects(book(order), /bloqueado/);
  assert.deepEqual((await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1', [order.id])).rows, before);
});

test('multiple blocks, edits across dates, all-day, stale edits and removal persist without discarding appointments', async () => {
  const order = await fixture(slot); await save(draft()); await save(draft({ start: '15:00', end: '16:00' }));
  let calendar = await readPickupCalendar('2026-12', db); assert.equal(calendar.blocks.length, 2);
  let first = calendar.blocks[0];
  await save({ ...first, date: '2026-12-02', allDay: true });
  await assert.rejects(save(first), /cambió/);
  calendar = await readPickupCalendar('2026-12', db);
  first = calendar.blocks.find(b => b.id === first.id);
  assert.equal(first.start, '00:00'); assert.equal(first.end, '24:00');
  assert.ok(!(await pickupAvailability(order, 'IMMEDIATE')).some(s => s.key.startsWith('2026-12-02|')));
  await changePickupBlackout({ ...first, action: 'remove' });
  assert.ok((await pickupAvailability(order, 'IMMEDIATE')).some(s => s.key.startsWith('2026-12-02|')));
  assert.equal((await db.query('SELECT status FROM pickup_appointments WHERE order_id=$1', [order.id])).rows[0].status, 'SCHEDULED');
});

test('invalid dates, ranges and oversized reasons fail before storage', () => {
  for (const body of [draft({ date: '2026-02-30' }), draft({ start: '12:00', end: '11:00' }), draft({ start: '25:00' }), draft({ reason: 'x'.repeat(501) })]) {
    assert.throws(() => blackoutInput(body), e => e.status === 400);
  }
});

test('contacts, conflicts and private reasons require the owner credential and never cache', async () => {
  const original = process.env.ADMIN_TOKEN; process.env.ADMIN_TOKEN = 'synthetic-owner';
  try {
    const calls = [];
    const handler = createPickupCalendarHandler({ read: async month => { calls.push(month); return { blocks: [{ reason: 'private' }] }; },
      change: async body => { calls.push(body); return { conflicts: [{ buyerPhone: '+595 000' }] }; } });
    for (const method of ['GET', 'POST']) for (const token of ['', 'wrong']) {
      const res = await handler(new Request('https://example.com/api/admin/pickup-calendar?month=2026-12', { method, headers: { 'x-admin-token': token } }));
      assert.equal(res.status, 401); assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(await res.text(), /private|595/);
    }
    assert.equal(calls.length, 0);
    const res = await handler(new Request('https://example.com/api/admin/pickup-calendar?month=2026-12', { headers: { 'x-admin-token': 'synthetic-owner' } }));
    assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.match(await res.text(), /private/);
    const post = await handler(new Request('https://example.com/api/admin/pickup-calendar', { method: 'POST', headers: { 'x-admin-token': 'synthetic-owner' }, body: JSON.stringify(draft()) }));
    assert.equal(post.status, 200); assert.match(await post.text(), /595/);
  } finally { if (original === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = original; }
});
