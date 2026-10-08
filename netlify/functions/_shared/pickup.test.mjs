import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickupEligible } from './pickup.mjs';

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
