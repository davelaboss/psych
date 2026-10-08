import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parsePaymentAdjustmentAmountPYG,
  parseVerifiedAmountPYG,
  recordPostSalePriceAdjustment,
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

function adjust(source, overrides = {}) {
  return recordPostSalePriceAdjustment(source, {
    kind: 'POST_SALE_PRICE_ADJUSTMENT',
    amountPYG: 30_000,
    internalNote: 'Reembolso acordado por reclamo posterior a la venta.',
    timestamp: TIMESTAMP,
    adjustmentId: 'adjustment-1',
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

test('records the exact Esilda post-sale adjustment without changing the original payment', () => {
  const originalPayment = payment({
    id: 'esilda-payment',
    type: 'FULL',
    amountPYG: 60_000,
    amountSource: 'LEGACY_RECONCILED',
    receipt: {
      storageKey: 'orders/VM-2026-E00AA2E0/receipt.pdf',
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
    },
    legacyAssumedAmountPYG: 60_000,
    reconciledAt: TIMESTAMP - 500,
    reconciledBy: 'ADMIN',
  });
  const pickup = { status: 'SCHEDULED', slotKey: '2026-12-09|08:00-12:00' };
  const esilda = order({
    id: 'VM-2026-E00AA2E0',
    status: 'PICKUP_SCHEDULED',
    totals: { totalPYG: 60_000, dueNowPYG: 60_000, futureBalancePYG: 0 },
    items: [{ productId: '142', saleMode: 'IMMEDIATE' }],
    payments: [originalPayment],
    pickup,
  });

  const result = adjust(esilda);
  assert.equal(result.totals.totalPYG, 60_000);
  assert.equal(result.grossOrderTotalPYG, 60_000);
  assert.equal(result.paidAmountPYG, 60_000);
  assert.equal(result.refundedAmountPYG, 30_000);
  assert.equal(result.adjustedOrderTotalPYG, 30_000);
  assert.equal(result.netReceivedPYG, 30_000);
  assert.equal(result.remainingBalancePYG, 0);
  assert.equal(result.status, 'PICKUP_SCHEDULED');
  assert.deepEqual(result.pickup, pickup);
  assert.deepEqual(result.payments[0], originalPayment);
  assert.deepEqual(result.paymentAdjustments, [{
    id: 'adjustment-1',
    kind: 'POST_SALE_PRICE_ADJUSTMENT',
    amountPYG: 30_000,
    createdAt: TIMESTAMP,
    createdBy: 'ADMIN',
    internalNote: 'Reembolso acordado por reclamo posterior a la venta.',
  }]);
});

test('missing adjustments derive as an empty collection with zero refunds', () => {
  const result = withPaymentState(order());
  assert.deepEqual(result.paymentAdjustments, []);
  assert.equal(result.refundedAmountPYG, 0);
  assert.equal(result.adjustedOrderTotalPYG, 250_000);
  assert.equal(result.netReceivedPYG, 62_500);
});

test('validates adjustment amount, exact kind, note, order state, and confirmed payment', () => {
  const paid = order({
    payments: [payment({ amountPYG: 250_000, amountSource: 'LEGACY_RECONCILED' })],
  });
  for (const value of ['', 0, -1, 1.5, '1.5', 'abc', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parsePaymentAdjustmentAmountPYG(value));
    assert.throws(() => adjust(paid, { amountPYG: value }));
  }
  assert.equal(parsePaymentAdjustmentAmountPYG('30000'), 30_000);
  assert.throws(() => adjust(paid, { kind: 'post_sale_price_adjustment' }), /tipo de ajuste/i);
  assert.throws(() => adjust(paid, { internalNote: '  ' }), /nota interna/i);
  assert.throws(() => adjust(paid, { internalNote: 'x'.repeat(2001) }), /2\.000 caracteres/i);
  assert.throws(() => adjust({ ...paid, status: 'CANCELLED' }), /pedido cancelado/i);
  assert.throws(() => adjust(order({
    payments: [payment({ verificationStatus: 'PENDING', amountPYG: null })],
  })), /no tiene un pago confirmado/i);
  assert.throws(() => adjust(order({
    payments: [payment({ amountPYG: 0 })],
  })), /no tiene un pago confirmado/i);
});

test('enforces individual and cumulative safe refundable amounts', () => {
  const source = order({
    totals: { totalPYG: 60_000, dueNowPYG: 60_000, futureBalancePYG: 0 },
    payments: [payment({ amountPYG: 60_000, amountSource: 'LEGACY_RECONCILED' })],
  });
  assert.throws(() => adjust(source, { amountPYG: 60_001 }), /supera el importe/i);

  const first = adjust(source, { amountPYG: 20_000 });
  assert.throws(() => adjust(first, {
    amountPYG: 40_001,
    adjustmentId: 'adjustment-2',
  }), /supera el importe/i);
  const second = adjust(first, { amountPYG: 10_000, adjustmentId: 'adjustment-2' });
  assert.equal(second.refundedAmountPYG, 30_000);
  assert.equal(second.adjustedOrderTotalPYG, 30_000);
  assert.equal(second.netReceivedPYG, 30_000);
  assert.equal(second.remainingBalancePYG, 0);

  const underpaid = order({
    totals: { totalPYG: 60_000, dueNowPYG: 30_000, futureBalancePYG: 30_000 },
    payments: [payment({ amountPYG: 40_000, amountSource: 'LEGACY_RECONCILED' })],
  });
  assert.throws(() => adjust(underpaid, { amountPYG: 40_001 }), /supera el importe/i);
});

test('preserves operational status and pickup data for every eligible paid state', () => {
  const pickup = { status: 'COMPLETED', slotKey: '2026-12-09|08:00-12:00' };
  const payments = [payment({ amountPYG: 250_000, amountSource: 'LEGACY_RECONCILED' })];
  for (const status of [
    'PAYMENT_CONFIRMED',
    'PAID_IN_FULL',
    'READY_TO_SCHEDULE',
    'PICKUP_SCHEDULED',
    'PICKED_UP',
  ]) {
    const result = adjust(order({ status, payments, pickup }));
    assert.equal(result.status, status);
    assert.deepEqual(result.pickup, pickup);
  }
});

test('reconciliation cannot reduce confirmed payments below recorded refunds', () => {
  const refunded = adjust(order({
    totals: { totalPYG: 60_000, dueNowPYG: 60_000, futureBalancePYG: 0 },
    payments: [payment({ amountPYG: 60_000 })],
  }));
  assert.throws(() => reconcile(refunded, {
    reconciledAmountPYG: 20_000,
  }), /reembolsos por encima/i);
});

test('duplicate voiding cannot reduce confirmed payments below recorded refunds', () => {
  const refunded = adjust(order({
    totals: { totalPYG: 60_000, dueNowPYG: 60_000, futureBalancePYG: 0 },
    payments: [
      payment({ id: 'valid-payment', amountPYG: 40_000, amountSource: 'ADMIN_VERIFIED' }),
      payment({ id: 'legacy-duplicate', amountPYG: 20_000 }),
    ],
  }), { amountPYG: 50_000 });
  assert.throws(() => voidDuplicate(refunded), /reembolsos por encima/i);
});
