import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseVerifiedAmountPYG,
  reconcileLegacyPayment,
  voidLegacyDuplicatePayment,
  withPaymentState,
} from './order-payments.mjs';

const TIMESTAMP = Date.parse('2026-10-07T12:00:00-03:00');

function payment(overrides = {}) {
  return {
    id: 'legacy-initial',
    type: 'DEPOSIT',
    amountPYG: 62_500,
    receipt: {
      storageKey: 'orders/VM-2026-0731E76C/receipt.pdf',
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
    },
    verificationStatus: 'CONFIRMED',
    confirmedAt: TIMESTAMP - 1000,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: 'VM-2026-0731E76C',
    status: 'DEPOSIT_CONFIRMED',
    totals: { totalPYG: 250_000, dueNowPYG: 62_500, futureBalancePYG: 187_500 },
    items: [{ productId: 'microwave', saleMode: 'DELAYED' }],
    payments: [payment()],
    paymentNotes: [],
    unrelated: { preserved: true },
    ...overrides,
  };
}

function reconcile(source, overrides = {}) {
  return reconcileLegacyPayment(source, {
    paymentId: 'legacy-initial',
    reconciledAmountPYG: 65_000,
    basis: 'ACTUAL_VERIFIED',
    internalNote: 'Monto confirmado contra el comprobante bancario.',
    timestamp: TIMESTAMP,
    noteId: 'note-1',
    ...overrides,
  });
}

function voidDuplicate(source, overrides = {}) {
  return voidLegacyDuplicatePayment(source, {
    paymentId: 'legacy-duplicate',
    internalNote: 'Comprobante duplicado de la transición histórica.',
    timestamp: TIMESTAMP,
    noteId: 'void-note-1',
    ...overrides,
  });
}

test('reconciles 62,500 to 65,000 and preserves the historical audit trail', () => {
  const original = order();
  const result = reconcile(original);
  assert.equal(result.paidAmountPYG, 65_000);
  assert.equal(result.remainingBalancePYG, 185_000);
  assert.equal(result.payments[0].id, 'legacy-initial');
  assert.deepEqual(result.payments[0].receipt, original.payments[0].receipt);
  assert.equal(result.payments[0].legacyAssumedAmountPYG, 62_500);
  assert.equal(result.payments[0].amountPYG, 65_000);
  assert.equal(result.payments[0].amountSource, 'LEGACY_RECONCILED');
  assert.equal(result.payments[0].verifiedBy, 'ADMIN');
  assert.equal(result.payments[0].reconciledBy, 'ADMIN');
  assert.equal(result.payments[0].reconciledAt, TIMESTAMP);
  assert.deepEqual(result.paymentNotes, [{
    id: 'note-1',
    kind: 'LEGACY_RECONCILIATION',
    text: 'Monto confirmado contra el comprobante bancario.',
    relatedPaymentId: 'legacy-initial',
    createdAt: TIMESTAMP,
    createdBy: 'ADMIN',
  }]);
});

test('seller-approved opening credit keeps distinct provenance', () => {
  const result = reconcile(order(), {
    basis: 'SELLER_APPROVED_CREDIT',
    internalNote: 'Crédito histórico aprobado por el vendedor.',
  });
  assert.equal(result.payments[0].amountSource, 'LEGACY_OPENING_CREDIT');
  assert.equal(result.payments[0].legacyAssumedAmountPYG, 62_500);
});

test('requires a non-empty internal reconciliation note', () => {
  assert.throws(() => reconcile(order(), { internalNote: '  ' }), /nota interna/i);
});

test('rejects blank, zero, negative, fractional, malformed, and unsafe amounts', () => {
  for (const value of ['', 0, -1, 1.5, '1.5', 'abc', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseVerifiedAmountPYG(value));
    assert.throws(() => reconcile(order(), { reconciledAmountPYG: value }));
  }
  assert.equal(parseVerifiedAmountPYG('65000'), 65_000);
});

test('rejects an unknown payment ID', () => {
  assert.throws(() => reconcile(order(), { paymentId: '' }), /Falta el pago histórico/i);
  assert.throws(() => reconcile(order(), { paymentId: 'missing' }), /No encontramos el pago histórico/i);
});

test('rejects an unknown reconciliation basis', () => {
  assert.throws(() => reconcile(order(), { basis: 'UNSUPPORTED' }), /cómo se estableció/i);
});

test('rejects pending, admin-verified, and already reconciled payments', () => {
  assert.throws(() => reconcile(order({
    payments: [payment({ verificationStatus: 'PENDING', amountPYG: null })],
  })), /no es un pago histórico/i);
  assert.throws(() => reconcile(order({
    payments: [payment({ amountSource: 'ADMIN_VERIFIED' })],
  })), /no es un pago histórico/i);
  assert.throws(() => reconcile(order({
    payments: [payment({ amountSource: 'LEGACY_RECONCILED' })],
  })), /no es un pago histórico/i);
  assert.throws(() => reconcile(order({
    payments: [payment({ amountSource: 'LEGACY_OPENING_CREDIT' })],
  })), /no es un pago histórico/i);
});

test('preserves other payments and unrelated order fields', () => {
  const other = payment({
    id: 'verified-payment',
    type: 'FINAL',
    amountPYG: 10_000,
    amountSource: 'ADMIN_VERIFIED',
  });
  const result = reconcile(order({ payments: [payment(), other] }));
  assert.deepEqual(result.payments[1], other);
  assert.deepEqual(result.unrelated, { preserved: true });
  assert.equal(result.paidAmountPYG, 75_000);
  assert.equal(result.remainingBalancePYG, 175_000);
});

test('recalculates active status but preserves completed and cancelled orders', () => {
  const paid = order({
    status: 'PAID_IN_FULL',
    payments: [payment({ type: 'FULL', amountPYG: 250_000 })],
  });
  assert.equal(reconcile(paid, { reconciledAmountPYG: 200_000 }).status, 'DEPOSIT_CONFIRMED');
  assert.equal(reconcile(order(), { reconciledAmountPYG: 250_000 }).status, 'PAID_IN_FULL');
  assert.equal(reconcile({ ...paid, status: 'PICKED_UP' }, { reconciledAmountPYG: 200_000 }).status, 'PICKED_UP');
  assert.equal(reconcile({ ...paid, status: 'CANCELLED' }, { reconciledAmountPYG: 200_000 }).status, 'CANCELLED');
});

test('preserves an existing paid operational scheduling state when balance remains zero', () => {
  const scheduled = order({
    status: 'PICKUP_SCHEDULED',
    payments: [payment({ type: 'FULL', amountPYG: 250_000 })],
  });
  assert.equal(reconcile(scheduled, { reconciledAmountPYG: 250_000 }).status, 'PICKUP_SCHEDULED');
});

test('voids Sandra duplicate payment and recalculates 507,500 to 290,000', () => {
  const valid = payment({
    id: 'payment-1',
    type: 'DEPOSIT',
    amountPYG: 290_000,
    amountSource: 'LEGACY_RECONCILED',
    legacyAssumedAmountPYG: 72_500,
    reconciledAt: TIMESTAMP - 500,
    reconciledBy: 'ADMIN',
  });
  const duplicate = payment({
    id: 'legacy-duplicate',
    type: 'FINAL',
    amountPYG: 217_500,
    amountSource: 'LEGACY_ASSUMED',
    historicalMarker: 'preserved',
  });
  const sandra = order({
    id: 'VM-2026-3B6A89CF',
    status: 'PAID_IN_FULL',
    totals: { totalPYG: 290_000, dueNowPYG: 72_500, futureBalancePYG: 217_500 },
    payments: [valid, duplicate],
  });

  assert.equal(withPaymentState(sandra).paidAmountPYG, 507_500);
  const result = voidDuplicate(sandra);
  const voided = result.payments[1];
  assert.equal(result.paidAmountPYG, 290_000);
  assert.equal(result.remainingBalancePYG, 0);
  assert.equal(result.status, 'PAID_IN_FULL');
  assert.equal(voided.id, duplicate.id);
  assert.equal(voided.amountPYG, 217_500);
  assert.deepEqual(voided.receipt, duplicate.receipt);
  assert.equal(voided.historicalMarker, 'preserved');
  assert.equal(voided.voidedAt, TIMESTAMP);
  assert.equal(voided.voidedBy, 'ADMIN');
  assert.equal(voided.voidReason, 'DUPLICATE_LEGACY_PAYMENT');
  assert.equal(voided.voidNoteId, 'void-note-1');
  assert.deepEqual(result.paymentNotes, [{
    id: 'void-note-1',
    kind: 'LEGACY_PAYMENT_VOID',
    text: 'Comprobante duplicado de la transición histórica.',
    relatedPaymentId: 'legacy-duplicate',
    createdAt: TIMESTAMP,
    createdBy: 'ADMIN',
  }]);
});

test('allows only confirmed historical sources to be voided', () => {
  for (const amountSource of [undefined, 'LEGACY_ASSUMED', 'LEGACY_RECONCILED', 'LEGACY_OPENING_CREDIT']) {
    const duplicate = payment({ id: 'legacy-duplicate', amountSource });
    const source = order({
      payments: [payment({ id: 'valid-payment', amountSource: 'ADMIN_VERIFIED' }), duplicate],
    });
    assert.equal(voidDuplicate(source).payments[1].voidReason, 'DUPLICATE_LEGACY_PAYMENT');
  }

  assert.throws(() => voidDuplicate(order({
    payments: [payment({ id: 'valid-payment' }), payment({
      id: 'legacy-duplicate',
      amountSource: 'ADMIN_VERIFIED',
    })],
  })), /no es un pago histórico/i);
});

test('rejects missing notes, unknown, pending, already-voided, and only confirmed payments', () => {
  const source = order({
    payments: [
      payment({ id: 'valid-payment', amountSource: 'ADMIN_VERIFIED' }),
      payment({ id: 'legacy-duplicate' }),
    ],
  });
  assert.throws(() => voidDuplicate(source, { internalNote: '  ' }), /nota interna/i);
  assert.throws(() => voidDuplicate(source, { paymentId: '' }), /Falta el pago histórico/i);
  assert.throws(() => voidDuplicate(source, { paymentId: 'missing' }), /No encontramos el pago histórico/i);
  assert.throws(() => voidDuplicate(order({
    payments: [payment({ id: 'valid-payment' }), payment({
      id: 'legacy-duplicate',
      verificationStatus: 'PENDING',
      amountPYG: null,
    })],
  })), /confirmado/i);
  assert.throws(() => voidDuplicate(order({
    payments: [payment({ id: 'valid-payment' }), payment({
      id: 'legacy-duplicate',
      voidedAt: TIMESTAMP - 1,
    })],
  })), /ya fue anulado/i);
  assert.throws(() => voidDuplicate(order({
    payments: [payment({ id: 'legacy-duplicate' })],
  })), /único pago confirmado/i);
});

test('voiding recalculates active status and preserves completed states', () => {
  const payments = [
    payment({ id: 'valid-payment', amountPYG: 100_000, amountSource: 'LEGACY_RECONCILED' }),
    payment({ id: 'legacy-duplicate', amountPYG: 150_000 }),
  ];
  assert.equal(voidDuplicate(order({ status: 'PAID_IN_FULL', payments })).status, 'DEPOSIT_CONFIRMED');
  assert.equal(voidDuplicate(order({ status: 'PICKED_UP', payments })).status, 'PICKED_UP');
  assert.equal(voidDuplicate(order({ status: 'CANCELLED', payments })).status, 'CANCELLED');

  const fullyPaid = [
    payment({ id: 'valid-payment', amountPYG: 250_000, amountSource: 'LEGACY_RECONCILED' }),
    payment({ id: 'legacy-duplicate', amountPYG: 10_000 }),
  ];
  assert.equal(voidDuplicate(order({ status: 'PICKUP_SCHEDULED', payments: fullyPaid })).status,
    'PICKUP_SCHEDULED');
});

test('a voided legacy payment cannot later be reconciled', () => {
  const source = order({
    payments: [payment({ id: 'valid-payment', amountSource: 'ADMIN_VERIFIED' }), payment({
      id: 'legacy-duplicate',
    })],
  });
  const voided = voidDuplicate(source);
  assert.throws(() => reconcile(voided, {
    paymentId: 'legacy-duplicate',
  }), /ya fue anulado/i);
});
