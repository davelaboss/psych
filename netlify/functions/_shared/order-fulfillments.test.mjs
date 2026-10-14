import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { deriveOrderFulfillmentParts } from './order-fulfillments.mjs';

const confirmed = (id, amountPYG, overrides = {}) => ({
  id, type: 'DEPOSIT', amountPYG, amountSource: 'ADMIN_VERIFIED', verifiedBy: 'ADMIN',
  verificationStatus: 'CONFIRMED', confirmedAt: 1, ...overrides,
});

const item = (itemNumber, saleMode, dueNowPYG, futureBalancePYG, window = {}) => ({
  productId: String(itemNumber), itemNumber, title: `Item ${itemNumber}`, quantity: 1,
  unitPricePYG: dueNowPYG + futureBalancePYG, saleMode, dueNowPYG, futureBalancePYG,
  ...window,
});

function mixed(payments, overrides = {}) {
  return {
    id: 'VM-2026-F823447F', status: 'DEPOSIT_CONFIRMED',
    totals: { totalPYG: 110_000, dueNowPYG: 72_500, futureBalancePYG: 37_500 },
    items: [
      item(381, 'IMMEDIATE', 30_000, 0),
      item(449, 'IMMEDIATE', 30_000, 0),
      item(474, 'DELAYED', 12_500, 37_500,
        { pickupWindowStart: '2026-12-09', pickupWindowEnd: '2026-12-12', depositPercent: 25 }),
    ],
    payments, paymentAdjustments: [], ...overrides,
  };
}

test('real mixed-order fixture unlocks immediate but not delayed after all due-now money is confirmed', () => {
  const parts = deriveOrderFulfillmentParts(mixed([confirmed('deposit', 72_500)]));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].itemIds, ['381', '449']);
  assert.equal(parts[0].timingKey, 'IMMEDIATE');
  assert.equal(parts[0].dueNowPYG, 60_000);
  assert.equal(parts[0].eligible, true);
  assert.equal(parts[1].timingKey, 'DELAYED:2026-12-09:2026-12-12');
  assert.equal(parts[1].dueNowPYG, 12_500);
  assert.equal(parts[1].futureBalancePYG, 37_500);
  assert.equal(parts[1].eligible, false);
  assert.equal(parts[1].orderRemainingBalancePYG, 37_500);
});

test('shortfall, pending receipt, approved short payment, and voided payment never unlock immediate', () => {
  const cases = [
    [confirmed('short', 72_499)],
    [{ id: 'pending', verificationStatus: 'PENDING', amountPYG: null }],
    [confirmed('approved-short', 70_000, { partialPaymentApproved: true })],
    [confirmed('voided', 72_500, { voidedAt: 2 })],
  ];
  for (const payments of cases) {
    assert.equal(deriveOrderFulfillmentParts(mixed(payments))[0].eligible, false);
  }
});

test('final confirmed payment unlocks delayed and preserves immediate eligibility', () => {
  const parts = deriveOrderFulfillmentParts(mixed([
    confirmed('deposit', 72_500), confirmed('final', 37_500, { type: 'FINAL' }),
  ], { status: 'PAID_IN_FULL' }));
  assert.deepEqual(parts.map(part => part.eligible), [true, true]);
});

test('immediate-only, delayed-only, refunds, and multiple delayed windows stay distinct', () => {
  const immediate = mixed([confirmed('full', 60_000, { type: 'FULL' })], {
    status: 'PAYMENT_CONFIRMED', totals: { totalPYG: 60_000, dueNowPYG: 60_000, futureBalancePYG: 0 },
    items: [item(381, 'IMMEDIATE', 60_000, 0)],
  });
  assert.deepEqual(deriveOrderFulfillmentParts(immediate).map(part => part.eligible), [true]);

  const delayed = mixed([confirmed('full', 50_000, { type: 'FULL' })], {
    status: 'PAID_IN_FULL', totals: { totalPYG: 50_000, dueNowPYG: 12_500, futureBalancePYG: 37_500 },
    items: [item(474, 'DELAYED', 12_500, 37_500,
      { pickupWindowStart: '2026-12-09', pickupWindowEnd: '2026-12-12' })],
  });
  assert.deepEqual(deriveOrderFulfillmentParts(delayed).map(part => part.eligible), [true]);

  const refunded = { ...immediate, paymentAdjustments: [
    { kind: 'POST_SALE_PRICE_ADJUSTMENT', amountPYG: 10_000 },
  ] };
  assert.equal(deriveOrderFulfillmentParts(refunded)[0].eligible, true);

  const multiple = mixed([confirmed('full', 160_000, { type: 'FULL' })], {
    status: 'PAID_IN_FULL', totals: { totalPYG: 160_000, dueNowPYG: 97_500, futureBalancePYG: 62_500 },
    items: [...mixed([]).items, item(500, 'DELAYED', 25_000, 25_000,
      { pickupWindowStart: '2027-01-01', pickupWindowEnd: '2027-01-02' })],
  });
  assert.equal(deriveOrderFulfillmentParts(multiple).length, 3);
});

test('legacy pickup migration preserves old any-delayed intent and changes the key safely', async () => {
  const sql = await readFile(new URL('../../database/migrations/20261010_pickup_fulfillment_parts.sql', import.meta.url), 'utf8');
  assert.match(sql, /WITH ORDINALITY/);
  assert.match(sql, /upper\(btrim\(COALESCE\(item\.value->>'saleMode'/);
  assert.match(sql, /'DELAYED:' \|\|/);
  assert.match(sql, /COALESCE\(\(.*'IMMEDIATE'\)/s);
  assert.match(sql, /PRIMARY KEY \(order_id, timing_key\)/);
});
