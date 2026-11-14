import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changePickup, pickupEligible, pickupSlotKeys } from './pickup.mjs';

function order(payments, overrides = {}) {
  return {
    id: 'VM-PICKUP',
    status: 'PAID_IN_FULL',
    totals: { totalPYG: 2_000_000, dueNowPYG: 500_000, futureBalancePYG: 1_500_000 },
    items: [{ productId: 'test', saleMode: 'DELAYED', dueNowPYG: 500_000, futureBalancePYG: 1_500_000 }],
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

const paidImmediate = () => order([confirmed('full', 2_000_000, { type: 'FULL' })], {
  status: 'PAYMENT_CONFIRMED', items: [{ productId: 'test', saleMode: 'IMMEDIATE', dueNowPYG: 2_000_000, futureBalancePYG: 0 }],
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

test('December 8 opens 08–20 while the immediate end date remains unchanged', () => {
  const keys = pickupSlotKeys(paidImmediate(), 'IMMEDIATE', '2026-12-08', '00:00');
  assert.deepEqual(keys, hourly(8, 20).map(time => `2026-12-08|${time}`));
  assert.deepEqual(pickupSlotKeys(paidImmediate(), 'IMMEDIATE', '2026-12-09', '00:00'), []);
});

test('delayed eligibility and order-specific date boundaries remain unchanged', () => {
  const delayed = order([confirmed('full', 2_000_000, { type: 'FULL' })]);
  const key = 'DELAYED:UNSET:UNSET';
  const keys = pickupSlotKeys(delayed, key, '2026-10-01', '00:00');
  assert.deepEqual([...new Set(keys.map(slot => slot.split('|')[0]))],
    ['2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12']);
  assert.deepEqual(keys.filter(slot => slot.startsWith('2026-12-12|')),
    hourly(8, 20).map(time => `2026-12-12|${time}`));
  const narrow = { ...delayed, items: [{ productId: 'test', saleMode: 'DELAYED', dueNowPYG: 500_000, futureBalancePYG: 1_500_000,
    pickupWindowStart: '2026-12-10', pickupWindowEnd: '2026-12-11' }] };
  assert.deepEqual([...new Set(pickupSlotKeys(narrow, 'DELAYED:2026-12-10:2026-12-11',
    '2026-10-01', '00:00').map(slot => slot.split('|')[0]))], ['2026-12-10', '2026-12-11']);
  assert.ok(pickupSlotKeys(order([confirmed('deposit', 500_000)]), key, '2026-10-01').length > 0);
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

test('delayed item windows can narrow but cannot expand December 9–12', () => {
  const delayed = order([confirmed('deposit',500_000)], { status: 'DEPOSIT_CONFIRMED', items: [{ productId: 'test', saleMode: 'DELAYED', dueNowPYG: 500_000, futureBalancePYG: 1_500_000,
    pickupWindowStart: '2026-12-01', pickupWindowEnd: '2026-12-20' }] });
  const keys = pickupSlotKeys(delayed, 'DELAYED:2026-12-01:2026-12-20', '2026-11-02', '00:00');
  assert.deepEqual([...new Set(keys.map(slot => slot.split('|')[0]))],
    ['2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12']);
});

test('local day and time use Paraguay even across UTC midnight', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-03T00:30:00Z') });
  const keys = pickupSlotKeys(paidImmediate(), 'IMMEDIATE');
  assert.equal(keys[0], '2026-11-03|08:00-09:00');
  t.mock.timers.setTime(Date.parse('2026-11-03T14:30:00Z'));
  assert.equal(pickupSlotKeys(paidImmediate(), 'IMMEDIATE')[0], '2026-11-03|13:00-14:00');
});
