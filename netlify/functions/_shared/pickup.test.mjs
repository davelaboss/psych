import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickupEligible } from './pickup.mjs';

function order(amountPYG, overrides = {}) {
  return {
    id: 'VM-PICKUP',
    status: 'PAID_IN_FULL',
    totals: { totalPYG: 2_000_000, dueNowPYG: 500_000 },
    items: [{ saleMode: 'DELAYED' }],
    payments: [{
      id: 'p1', type: 'FULL', amountPYG, amountSource: 'ADMIN_VERIFIED',
      verificationStatus: 'CONFIRMED', confirmedAt: Date.now(),
    }],
    ...overrides,
  };
}

test('pickup remains unavailable with one guaraní outstanding', () => {
  assert.equal(pickupEligible(order(1_999_999, { status: 'DEPOSIT_CONFIRMED' })), false);
});

test('pickup becomes eligible only at cumulative full payment', () => {
  const cumulative = order(500_000, {
    payments: [
      { id: 'p1', type: 'DEPOSIT', amountPYG: 500_000, amountSource: 'ADMIN_VERIFIED', verificationStatus: 'CONFIRMED' },
      { id: 'p2', type: 'FINAL', amountPYG: 1_500_000, amountSource: 'ADMIN_VERIFIED', verificationStatus: 'CONFIRMED' },
    ],
  });
  assert.equal(pickupEligible(cumulative), true);
});

test('payment type FULL cannot grant pickup when the verified amount is incomplete', () => {
  assert.equal(pickupEligible(order(500_000)), false);
});

test('immediate orders retain their operational status requirement', () => {
  const immediate = order(2_000_000, { status: 'PAYMENT_CONFIRMED', items: [{ saleMode: 'IMMEDIATE' }] });
  assert.equal(pickupEligible(immediate), true);
  assert.equal(pickupEligible({ ...immediate, status: 'DEPOSIT_CONFIRMED' }), false);
});
