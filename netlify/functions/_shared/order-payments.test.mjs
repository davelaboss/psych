import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPaymentConfirmation,
  confirmationRequiresInventoryCommit,
  parseVerifiedAmountPYG,
  publicPayments,
  reconcileLegacyPayment,
  withPaymentState,
} from './order-payments.mjs';

const OCTOBER = Date.parse('2026-10-07T12:00:00-03:00');
const DECEMBER = Date.parse('2026-12-01T12:00:00-03:00');

function payment(id, overrides = {}) {
  return {
    id,
    type: 'PENDING',
    amountPYG: null,
    receipt: { storageKey: `order/${id}`, fileName: `${id}.pdf`, contentType: 'application/pdf' },
    submittedAt: OCTOBER,
    submittedBy: 'CUSTOMER',
    paymentMethod: 'BANK_TRANSFER',
    verificationStatus: 'PENDING',
    confirmedAt: null,
    ...overrides,
  };
}

function delayedOrder(overrides = {}) {
  return {
    id: 'VM-TEST',
    status: 'RECEIPT_RECEIVED',
    buyer: { name: 'María' },
    totals: { totalPYG: 2_000_000, dueNowPYG: 500_000, futureBalancePYG: 1_500_000 },
    items: [{ saleMode: 'DELAYED' }],
    payments: [payment('p1')],
    paymentNotes: [],
    unrelated: { preserved: true },
    ...overrides,
  };
}

function confirm(order, id, amount, overrides = {}) {
  const existing = order.payments.find(candidate => candidate.id === id);
  return applyPaymentConfirmation(order, {
    paymentId: id,
    paymentType: existing?.verificationStatus === 'CONFIRMED'
      ? existing.type
      : order.payments.some(candidate => candidate.verificationStatus === 'CONFIRMED') ? 'FINAL' : 'DEPOSIT',
    verifiedAmountPYG: amount,
    timestamp: OCTOBER,
    ...overrides,
  });
}

function addPending(order, id) {
  return { ...order, status: 'FINAL_RECEIPT_RECEIVED', payments: [...order.payments, payment(id)] };
}

test('records 495,000 against a 500,000 seña as the actual verified amount', () => {
  const result = confirm(delayedOrder(), 'p1', 495_000, {
    approvePartialPayment: true,
    internalNote: 'Aprobados Gs. 5.000 para después.',
  });
  assert.equal(result.order.confirmedPaidPYG, 495_000);
  assert.equal(result.order.remainingBalancePYG, 1_505_000);
  assert.equal(result.order.depositShortfallPYG, 5_000);
  assert.equal(result.order.paymentState, 'PARTIALLY_PAID');
  assert.equal(result.order.payments[0].amountSource, 'ADMIN_VERIFIED');
  assert.equal(result.order.payments[0].verifiedBy, 'ADMIN');
  assert.equal(result.order.payments[0].partialPaymentApproved, true);
  assert.equal(result.order.paymentNotes[0].kind, 'EXCEPTION');
  assert.equal(result.order.payments[0].exceptionNoteId, result.order.paymentNotes[0].id);
});

test('supports multiple later installments and exact cumulative totals', () => {
  let order = confirm(delayedOrder(), 'p1', 500_000).order;
  order = confirm(addPending(order, 'p2'), 'p2', 100_000).order;
  order = confirm(addPending(order, 'p3'), 'p3', 250_000).order;
  assert.equal(order.confirmedPaidPYG, 850_000);
  assert.equal(order.remainingBalancePYG, 1_150_000);
  assert.equal(order.payments.length, 3);
});

test('exact seña satisfies the deposit without an exception note', () => {
  const { order } = confirm(delayedOrder(), 'p1', 500_000);
  assert.equal(order.paymentState, 'DEPOSIT_SATISFIED');
  assert.equal(order.depositShortfallPYG, 0);
  assert.deepEqual(order.paymentNotes, []);
});

test('partial seña requires approval and an internal note', () => {
  assert.throws(() => confirm(delayedOrder(), 'p1', 495_000), /aprobar expresamente/i);
  assert.throws(() => confirm(delayedOrder(), 'p1', 495_000,
    { approvePartialPayment: true }), /nota interna/i);
});

test('full payment is reached cumulatively and final balance is exactly zero', () => {
  let order = confirm(delayedOrder(), 'p1', 500_000).order;
  order = confirm(addPending(order, 'p2'), 'p2', 1_500_000).order;
  assert.equal(order.confirmedPaidPYG, 2_000_000);
  assert.equal(order.remainingBalancePYG, 0);
  assert.equal(order.paymentState, 'FULLY_PAID');
  assert.equal(order.status, 'PAID_IN_FULL');
});

test('same confirmation retry is idempotent and conflicting retries fail', () => {
  const first = confirm(delayedOrder(), 'p1', 500_000);
  const retry = confirm(first.order, 'p1', 500_000);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.order.confirmedPaidPYG, 500_000);
  assert.throws(() => confirm(first.order, 'p1', 499_999), /otro importe/i);
  assert.throws(() => confirm(first.order, 'p1', 500_000, { paymentType: 'FULL' }), /otra clasificación/i);
});

test('pending receipts contribute zero', () => {
  const order = withPaymentState(delayedOrder(), OCTOBER);
  assert.equal(order.confirmedPaidPYG, 0);
  assert.equal(order.remainingBalancePYG, 2_000_000);
  assert.equal(order.paymentState, 'UNPAID');
});

test('confirmation requires the exact pending payment ID', () => {
  assert.throws(() => applyPaymentConfirmation(delayedOrder(), {
    paymentId: '', paymentType: 'DEPOSIT', verifiedAmountPYG: 500_000, timestamp: OCTOBER,
  }), /identificador exacto/i);
  assert.throws(() => applyPaymentConfirmation(delayedOrder(), {
    paymentId: 'missing', paymentType: 'DEPOSIT', verifiedAmountPYG: 500_000, timestamp: OCTOBER,
  }), /No encontramos el pago indicado/i);
});

test('public payments include confirmed date and amount only and never expose internal notes', () => {
  const { order } = confirm(delayedOrder(), 'p1', 500_000);
  assert.deepEqual(publicPayments(order), [{ id: 'p1', amountPYG: 500_000, confirmedAt: OCTOBER }]);
  assert.equal('paymentNotes' in publicPayments(order)[0], false);
  assert.equal('amountSource' in publicPayments(order)[0], false);
  assert.equal('verifiedBy' in publicPayments(order)[0], false);
  assert.equal('receipt' in publicPayments(order)[0], false);
});

test('legacy assumed active payment blocks a new installment', () => {
  const order = delayedOrder({
    status: 'FINAL_RECEIPT_RECEIVED',
    payments: [
      payment('legacy', { type: 'DEPOSIT', amountPYG: 500_000, verificationStatus: 'CONFIRMED', confirmedAt: OCTOBER }),
      payment('p2'),
    ],
  });
  assert.throws(() => confirm(order, 'p2', 100_000), /Reconciliá los pagos históricos/i);
});

test('legacy reconciliation preserves prior assumption and permits a later installment', () => {
  let order = delayedOrder({
    status: 'DEPOSIT_CONFIRMED',
    payments: [payment('legacy', {
      type: 'DEPOSIT', amountPYG: 500_000, verificationStatus: 'CONFIRMED', confirmedAt: OCTOBER,
    })],
  });
  order = reconcileLegacyPayment(order, {
    paymentId: 'legacy',
    reconciledAmountPYG: 495_000,
    basis: 'ACTUAL_VERIFIED',
    internalNote: 'Monto confirmado contra el extracto bancario.',
    timestamp: OCTOBER,
  });
  assert.equal(order.payments[0].legacyAssumedAmountPYG, 500_000);
  assert.equal(order.payments[0].amountPYG, 495_000);
  assert.equal(order.payments[0].amountSource, 'LEGACY_RECONCILED');
  order = confirm(addPending(order, 'p2'), 'p2', 100_000).order;
  assert.equal(order.confirmedPaidPYG, 595_000);
});

test('completed historical orders are not rewritten or regressed by read derivation', () => {
  const original = delayedOrder({
    status: 'PICKED_UP',
    payments: [payment('legacy', {
      type: 'FULL', amountPYG: 2_000_000, verificationStatus: 'CONFIRMED', confirmedAt: OCTOBER,
    })],
  });
  const derived = withPaymentState(original, OCTOBER);
  assert.equal(derived.status, 'PICKED_UP');
  assert.equal(derived.payments[0].amountSource, undefined);
  assert.equal(derived.hasLegacyAssumedPayments, true);
});

test('rejects blank, zero, negative, fractional, malformed, and unsafe amounts', () => {
  for (const value of ['', 0, -1, 1.5, '1.5', 'abc', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseVerifiedAmountPYG(value));
  }
  assert.equal(parseVerifiedAmountPYG('495000'), 495_000);
  assert.throws(() => withPaymentState(delayedOrder({
    payments: [
      payment('a', { amountPYG: Number.MAX_SAFE_INTEGER, verificationStatus: 'CONFIRMED' }),
      payment('b', { amountPYG: 1, verificationStatus: 'CONFIRMED' }),
    ],
  }), OCTOBER), /total confirmado excede/i);
});

test('overpayment requires acknowledgment and preserves the full received amount', () => {
  assert.throws(() => applyPaymentConfirmation(delayedOrder(), {
    paymentId: 'p1', paymentType: 'FULL', verifiedAmountPYG: 2_005_000, timestamp: OCTOBER,
  }), /sobrepago/i);
  const { order } = applyPaymentConfirmation(delayedOrder(), {
    paymentId: 'p1', paymentType: 'FULL', verifiedAmountPYG: 2_005_000,
    acknowledgeOverpayment: true, timestamp: OCTOBER,
  });
  assert.equal(order.confirmedPaidPYG, 2_005_000);
  assert.equal(order.remainingBalancePYG, 0);
  assert.equal(order.overpaymentPYG, 5_000);
  assert.equal(order.payments[0].overpaymentAcknowledged, true);
});

test('delayed order accepts an early installment even when expected now is zero', () => {
  let order = confirm(delayedOrder(), 'p1', 500_000).order;
  assert.equal(withPaymentState(order, OCTOBER).expectedNowPYG, 0);
  order = confirm(addPending(order, 'p2'), 'p2', 100_000).order;
  assert.equal(order.confirmedPaidPYG, 600_000);
  assert.equal(withPaymentState(order, DECEMBER).expectedNowPYG, 1_400_000);
});

test('receipt association and unrelated order data are preserved', () => {
  const original = delayedOrder();
  const { order } = confirm(original, 'p1', 500_000);
  assert.deepEqual(order.payments[0].receipt, original.payments[0].receipt);
  assert.deepEqual(order.unrelated, { preserved: true });
});

test('inventory commit decision is true only for the first non-idempotent confirmation', () => {
  const first = confirm(delayedOrder(), 'p1', 500_000);
  assert.equal(confirmationRequiresInventoryCommit(null, first), true);
  const approvedPartial = confirm(delayedOrder(), 'p1', 495_000, {
    approvePartialPayment: true, internalNote: 'Excepción aprobada.',
  });
  assert.equal(confirmationRequiresInventoryCommit(null, approvedPartial), true);
  assert.equal(confirmationRequiresInventoryCommit(OCTOBER, first), false);
  const retry = confirm(first.order, 'p1', 500_000);
  assert.equal(confirmationRequiresInventoryCommit(null, retry), false);
});
