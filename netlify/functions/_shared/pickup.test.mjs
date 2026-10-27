import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changePickup, pickupEligible, pickupSlotKeys } from './pickup.mjs';

function order(payments, overrides = {}) {
  return {
    id: 'VM-PICKUP',
    status: 'PAID_IN_FULL',
    totals: { totalPYG: 2_000_000, dueNowPYG: 500_000, futureBalancePYG: 1_500_000 },
    items: [{ saleMode: 'DELAYED' }],
    payments,
    paymentAdjustments: [],
    ...overrides,
  };
}

function confirmed(id, amountPYG, overrides = {}) {
  return {
    id,
    type: 'DEPOSIT',
    amountPYG,
    amountSource: 'ADMIN_VERIFIED',
    verifiedBy: 'ADMIN',
    verificationStatus: 'CONFIRMED',
    confirmedAt: Date.now(),
    ...overrides,
  };
}

test('receipt upload alone and partial payment never grant pickup', () => {
  const pending = order([{
    id: 'pending', type: 'PENDING', amountPYG: null, verificationStatus: 'PENDING',
  }], { status: 'RECEIPT_RECEIVED' });
  assert.equal(pickupEligible(pending), false);
  assert.equal(pickupEligible(order([
    confirmed('partial', 500_000, { type: 'FULL' }),
  ], { status: 'PAYMENT_CONFIRMED' })), false);
});

test('payment type alone cannot grant pickup while a balance remains', () => {
  assert.equal(pickupEligible(order([
    confirmed('partial-full', 1_999_999, { type: 'FULL' }),
  ], { status: 'PAID_IN_FULL' })), false);
});

test('pickup becomes eligible only at cumulative full payment and the required status', () => {
  const cumulative = order([
    confirmed('deposit', 500_000),
    confirmed('installment', 100_000, { type: 'FINAL' }),
    confirmed('final', 1_400_000, { type: 'FINAL' }),
  ]);
  assert.equal(pickupEligible(cumulative), true);
  assert.equal(pickupEligible({ ...cumulative, status: 'DEPOSIT_CONFIRMED' }), false);

  const immediate = order([confirmed('full', 2_000_000, { type: 'FULL' })], {
    status: 'PAYMENT_CONFIRMED',
    items: [{ saleMode: 'IMMEDIATE' }],
  });
  assert.equal(pickupEligible(immediate), true);
});

test('voided payments are excluded and a matched post-sale adjustment stays eligible', () => {
  assert.equal(pickupEligible(order([
    confirmed('valid', 500_000),
    confirmed('voided', 1_500_000, { voidedAt: Date.now() }),
  ], { status: 'PAID_IN_FULL' })), false);

  const esilda = order([confirmed('esilda', 60_000, { type: 'FULL' })], {
    id: 'VM-2026-E00AA2E0',
    status: 'PAYMENT_CONFIRMED',
    totals: { totalPYG: 60_000, dueNowPYG: 60_000, futureBalancePYG: 0 },
    items: [{ saleMode: 'IMMEDIATE' }],
    paymentAdjustments: [{ kind: 'POST_SALE_PRICE_ADJUSTMENT', amountPYG: 30_000 }],
  });
  assert.equal(pickupEligible(esilda), true);
});

test('mixed order exposes slots only for the eligible timing part', () => {
  const mixed = order([confirmed('deposit', 72_500)], {
    status: 'DEPOSIT_CONFIRMED',
    totals: { totalPYG: 110_000, dueNowPYG: 72_500, futureBalancePYG: 37_500 },
    items: [
      { productId: '381', saleMode: 'IMMEDIATE', quantity: 1, unitPricePYG: 30_000,
        dueNowPYG: 30_000, futureBalancePYG: 0 },
      { productId: '449', saleMode: 'IMMEDIATE', quantity: 1, unitPricePYG: 30_000,
        dueNowPYG: 30_000, futureBalancePYG: 0 },
      { productId: '474', saleMode: 'DELAYED', quantity: 1, unitPricePYG: 50_000,
        dueNowPYG: 12_500, futureBalancePYG: 37_500,
        pickupWindowStart: '2026-12-09', pickupWindowEnd: '2026-12-12' },
    ],
  });
  assert.equal(pickupEligible(mixed), false);
  assert.equal(pickupEligible(mixed, 'IMMEDIATE'), true);
  assert.ok(pickupSlotKeys(mixed, 'IMMEDIATE', '2026-10-01').length > 0);
  assert.deepEqual(pickupSlotKeys(mixed, 'DELAYED:2026-12-09:2026-12-12', '2026-10-01'), []);
});

test('scheduling and cancelling one timing key never alter the other appointment', async () => {
  const mixedPaid = order([confirmed('full', 110_000, { type: 'FULL' })], {
    id: 'VM-MIXED', status: 'PAID_IN_FULL',
    totals: { totalPYG: 110_000, dueNowPYG: 72_500, futureBalancePYG: 37_500 },
    items: [
      { productId: '381', saleMode: 'IMMEDIATE', quantity: 1, unitPricePYG: 60_000,
        dueNowPYG: 60_000, futureBalancePYG: 0 },
      { productId: '474', saleMode: 'DELAYED', quantity: 1, unitPricePYG: 50_000,
        dueNowPYG: 12_500, futureBalancePYG: 37_500,
        pickupWindowStart: '2026-12-09', pickupWindowEnd: '2026-12-12' },
    ],
  });
  const delayedKey = 'DELAYED:2026-12-09:2026-12-12';
  const rows = new Map([[delayedKey, { order_id: mixedPaid.id, timing_key: delayedKey,
    slot_key: '2026-12-09|08:00-12:00', status: 'SCHEDULED', changed_by: 'CUSTOMER', revision: 4,
    updated_at: new Date(1) }]]);
  const notifications = [];
  const client = { async query(sql, params = []) {
    if (sql.includes('SELECT order_snapshot')) return { rows: [{ order_snapshot: mixedPaid }] };
    if (sql.includes('WHERE order_id=$1 AND timing_key=$2')) return { rows: rows.has(params[1]) ? [rows.get(params[1])] : [] };
    if (sql.includes('count(*)::int')) return { rows: [{ count: 0 }] };
    if (sql.includes('INSERT INTO pickup_windows') || sql.includes('SELECT slot_key FROM pickup_windows')) return { rows: [] };
    if (sql.includes('INSERT INTO pickup_appointments')) {
      const previous = rows.get(params[1]);
      const row = { order_id: params[0], timing_key: params[1], slot_key: params[2], status: params[3],
        changed_by: params[4], revision: (previous?.revision || 0) + 1, updated_at: new Date(2) };
      rows.set(params[1], row);
      return { rows: [row] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const dependencies = {
    transaction: callback => callback(client),
    queueNotifications: async (_client, event) => notifications.push(event),
    slotKeys: () => ['2026-10-15|08:00-12:00'],
  };

  await changePickup({ orderId: mixedPaid.id, timingKey: 'IMMEDIATE',
    slotKey: '2026-10-15|08:00-12:00', actor: 'CUSTOMER' }, dependencies);
  assert.equal(rows.get(delayedKey).slot_key, '2026-12-09|08:00-12:00');
  assert.equal(rows.get('IMMEDIATE').status, 'SCHEDULED');

  await changePickup({ orderId: mixedPaid.id, timingKey: 'IMMEDIATE',
    slotKey: null, actor: 'ADMIN' }, dependencies);
  assert.equal(rows.get('IMMEDIATE').status, 'CANCELLED');
  assert.equal(rows.get(delayedKey).status, 'SCHEDULED');
  assert.match(notifications[0].key, /:IMMEDIATE:/);
  assert.equal(notifications.length, 1);
});

const paidImmediate = () => order([confirmed('full', 2_000_000, { type: 'FULL' })], {
  status: 'PAYMENT_CONFIRMED', items: [{ saleMode: 'IMMEDIATE' }],
});
const hourly = (from, to) => Array.from({ length: to - from }, (_, i) =>
  `${String(from + i).padStart(2, '0')}:00-${String(from + i + 1).padStart(2, '0')}:00`);

for (const [weekday, day, expected] of [
  ['Monday', '2026-11-02', hourly(8, 20)],
  ['Tuesday', '2026-11-03', [...hourly(8, 12), ...hourly(13, 16)]],
  ['Wednesday', '2026-11-04', hourly(8, 20)],
  ['Thursday', '2026-11-05', hourly(8, 20)],
  ['Friday', '2026-11-06', hourly(8, 20)],
  ['Saturday', '2026-11-07', hourly(14, 17)],
  ['Sunday', '2026-11-08', hourly(8, 20)],
]) test(`${weekday} offers exactly the authorized contiguous hourly ranges`, () => {
  const keys = pickupSlotKeys(paidImmediate(), 'IMMEDIATE', '2026-10-01', '00:00');
  assert.deepEqual(keys.filter(key => key.startsWith(`${day}|`)), expected.map(time => `${day}|${time}`));
});

test('December 8 exception and immediate end date remain unchanged', () => {
  const keys = pickupSlotKeys(paidImmediate(), 'IMMEDIATE', '2026-12-08', '00:00');
  assert.deepEqual(keys, hourly(13, 17).map(time => `2026-12-08|${time}`));
  assert.deepEqual(pickupSlotKeys(paidImmediate(), 'IMMEDIATE', '2026-12-09', '00:00'), []);
});

test('delayed eligibility and order-specific date boundaries remain unchanged', () => {
  const delayed = order([confirmed('full', 2_000_000, { type: 'FULL' })]);
  const key = 'DELAYED:UNSET:UNSET';
  const keys = pickupSlotKeys(delayed, key, '2026-10-01', '00:00');
  assert.deepEqual([...new Set(keys.map(slot => slot.split('|')[0]))],
    ['2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12']);
  assert.deepEqual(keys.filter(slot => slot.startsWith('2026-12-12|')),
    hourly(14, 17).map(time => `2026-12-12|${time}`));
  const narrow = { ...delayed, items: [{ saleMode: 'DELAYED',
    pickupWindowStart: '2026-12-10', pickupWindowEnd: '2026-12-11' }] };
  assert.deepEqual([...new Set(pickupSlotKeys(narrow, 'DELAYED:2026-12-10:2026-12-11',
    '2026-10-01', '00:00').map(slot => slot.split('|')[0]))], ['2026-12-10', '2026-12-11']);
  assert.deepEqual(pickupSlotKeys(order([confirmed('deposit', 500_000)]), key, '2026-10-01'), []);
});

test('current-day slots exclude started hours, exact boundaries and previous dates', () => {
  const keys = pickupSlotKeys(paidImmediate(), 'IMMEDIATE', '2026-11-02', '11:30');
  assert.ok(keys.every(key => key.split('|')[0] >= '2026-11-02'));
  assert.deepEqual(keys.filter(key => key.startsWith('2026-11-02|')),
    hourly(12, 20).map(time => `2026-11-02|${time}`));
  assert.equal(pickupSlotKeys(paidImmediate(), 'IMMEDIATE', '2026-11-02', '12:00')[0],
    '2026-11-02|13:00-14:00');
  assert.equal(pickupSlotKeys(paidImmediate(), 'IMMEDIATE', '2026-11-02', '20:00')[0],
    '2026-11-03|08:00-09:00');
});

test('local day and time use Paraguay even across UTC midnight', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-03T00:30:00Z') });
  const keys = pickupSlotKeys(paidImmediate(), 'IMMEDIATE');
  assert.equal(keys[0], '2026-11-03|08:00-09:00');
  t.mock.timers.setTime(Date.parse('2026-11-03T14:30:00Z'));
  assert.equal(pickupSlotKeys(paidImmediate(), 'IMMEDIATE')[0], '2026-11-03|13:00-14:00');
});
