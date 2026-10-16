import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPaymentConfirmation,
  confirmationRequiresInventoryCommit,
  parsePaymentAdjustmentAmountPYG,
  parseVerifiedAmountPYG,
  recordPostSalePriceAdjustment,
  reconcileLegacyPayment,
  publicPayments,
  voidLegacyDuplicatePayment,
  withPaymentState,
} from './order-payments.mjs';

const TIMESTAMP = Date.parse('2026-10-07T12:00:00-03:00');
const OCTOBER = Date.parse('2026-10-08T12:00:00-03:00');
const DECEMBER = Date.parse('2026-12-01T00:00:00-03:00');

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

function pendingPayment(id = 'pending-1') {
  return {
    id,
    type: 'PENDING',
    amountPYG: null,
    receipt: { storageKey: `orders/VM-ROUTINE/${id}.pdf`, fileName: `${id}.pdf` },
    submittedAt: OCTOBER - 1000,
    submittedBy: 'CUSTOMER',
    paymentMethod: 'BANK_TRANSFER',
    verificationStatus: 'PENDING',
    confirmedAt: null,
  };
}

function routineOrder(overrides = {}) {
  return {
    id: 'VM-ROUTINE',
    status: 'RECEIPT_RECEIVED',
    totals: { totalPYG: 2_000_000, dueNowPYG: 500_000, futureBalancePYG: 1_500_000 },
    items: [{ productId: 'delayed-item', saleMode: 'DELAYED' }],
    payments: [pendingPayment()],
    paymentNotes: [],
    paymentAdjustments: [],
    unrelated: { preserved: true },
    ...overrides,
  };
}

function confirmRoutine(source, amount, overrides = {}) {
  return applyPaymentConfirmation(source, {
    paymentId: 'pending-1',
    paymentType: 'DEPOSIT',
    verifiedAmountPYG: amount,
    timestamp: OCTOBER,
    noteId: 'exception-1',
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

test('new routine deposit records the exact amount with ADMIN_VERIFIED provenance', () => {
  const original = routineOrder();
  const result = confirmRoutine(original, 500_000);
  const confirmed = result.order.payments[0];
  assert.equal(result.idempotent, false);
  assert.equal(confirmed.id, 'pending-1');
  assert.equal(confirmed.amountPYG, 500_000);
  assert.equal(confirmed.amountSource, 'ADMIN_VERIFIED');
  assert.equal(confirmed.verifiedBy, 'ADMIN');
  assert.equal(confirmed.verificationStatus, 'CONFIRMED');
  assert.equal(confirmed.confirmedAt, OCTOBER);
  assert.deepEqual(confirmed.receipt, original.payments[0].receipt);
  assert.equal(result.order.hasLegacyAssumedPayments, false);
  assert.equal(result.order.paymentState, 'DEPOSIT_SATISFIED');
  assert.equal(result.order.remainingBalancePYG, 1_500_000);
});

test('Adelina-like routine deposit never derives as legacy assumed', () => {
  const adelina = routineOrder({
    id: 'VM-2026-B8BEE9BA',
    totals: { totalPYG: 1_300_000, dueNowPYG: 325_000, futureBalancePYG: 975_000 },
  });
  const result = confirmRoutine(adelina, 325_000).order;
  assert.equal(result.paidAmountPYG, 325_000);
  assert.equal(result.remainingBalancePYG, 975_000);
  assert.equal(result.payments[0].amountSource, 'ADMIN_VERIFIED');
  assert.deepEqual(result.legacyAssumedPaymentIds, []);
});

test('routine confirmation requires the exact pending payment ID', () => {
  assert.throws(() => confirmRoutine(routineOrder(), 500_000, { paymentId: '' }), /identificador exacto/i);
  assert.throws(() => confirmRoutine(routineOrder(), 500_000, { paymentId: 'missing' }), /No encontramos/i);
  const multiple = routineOrder({ payments: [pendingPayment('other'), pendingPayment('pending-1')] });
  const result = confirmRoutine(multiple, 500_000).order;
  assert.equal(result.payments[0].verificationStatus, 'PENDING');
  assert.equal(result.payments[1].verificationStatus, 'CONFIRMED');
});

test('idempotent retry is limited to matching non-voided ADMIN_VERIFIED payments', () => {
  const first = confirmRoutine(routineOrder(), 500_000).order;
  const retry = confirmRoutine(first, 500_000);
  assert.equal(retry.idempotent, true);
  assert.throws(() => confirmRoutine(first, 500_001), /otro importe/i);
  assert.throws(() => confirmRoutine(first, 500_000, { paymentType: 'FINAL' }), /otra clasificación/i);

  for (const amountSource of [undefined, 'LEGACY_ASSUMED', 'LEGACY_RECONCILED', 'LEGACY_OPENING_CREDIT']) {
    const source = routineOrder({ payments: [{
      ...pendingPayment(), type: 'DEPOSIT', amountPYG: 500_000, amountSource,
      verifiedBy: 'ADMIN', verificationStatus: 'CONFIRMED', confirmedAt: OCTOBER,
    }] });
    assert.throws(() => confirmRoutine(source, 500_000), /no pertenece al flujo rutinario/i);
  }
  assert.throws(() => confirmRoutine(routineOrder({ payments: [{
    ...pendingPayment(), type: 'DEPOSIT', amountPYG: 500_000, amountSource: 'ADMIN_VERIFIED',
    verificationStatus: 'CONFIRMED', confirmedAt: OCTOBER,
  }] }), 500_000), /no pertenece al flujo rutinario/i);
  assert.throws(() => confirmRoutine(routineOrder({ payments: [{
    ...pendingPayment(), type: 'DEPOSIT', amountPYG: 500_000, amountSource: 'ADMIN_VERIFIED',
    verifiedBy: 'ADMIN', verificationStatus: 'CONFIRMED', confirmedAt: OCTOBER, voidedAt: OCTOBER + 1,
  }] }), 500_000), /no pertenece al flujo rutinario/i);
});

test('partial deposit requires explicit approval and a linked internal note', () => {
  assert.throws(() => confirmRoutine(routineOrder(), 495_000), /aprobar expresamente/i);
  assert.throws(() => confirmRoutine(routineOrder(), 495_000, {
    approvePartialPayment: true,
    internalNote: '  ',
  }), /nota interna/i);
  const result = confirmRoutine(routineOrder(), 495_000, {
    approvePartialPayment: true,
    internalNote: 'El vendedor aprobó la diferencia de Gs. 5.000.',
  }).order;
  assert.equal(result.paidAmountPYG, 495_000);
  assert.equal(result.depositShortfallPYG, 5_000);
  assert.equal(result.paymentState, 'PARTIALLY_PAID');
  assert.equal(result.payments[0].partialPaymentApproved, true);
  assert.equal(result.payments[0].exceptionNoteId, 'exception-1');
  assert.deepEqual(result.paymentNotes, [{
    id: 'exception-1',
    kind: 'EXCEPTION',
    text: 'El vendedor aprobó la diferencia de Gs. 5.000.',
    relatedPaymentId: 'pending-1',
    createdAt: OCTOBER,
    createdBy: 'ADMIN',
  }]);
});

test('exact deposit and an amount above the deposit are preserved without fabrication', () => {
  const exact = confirmRoutine(routineOrder(), 500_000).order;
  assert.equal(exact.depositShortfallPYG, 0);
  assert.equal(exact.paymentNotes.length, 0);
  const extra = confirmRoutine(routineOrder(), 600_000).order;
  assert.equal(extra.paidAmountPYG, 600_000);
  assert.equal(extra.remainingBalancePYG, 1_400_000);
  assert.equal(extra.paymentState, 'DEPOSIT_SATISFIED');
});

test('supports early and multiple installments through final payment', () => {
  let current = confirmRoutine(routineOrder(), 500_000).order;
  assert.equal(withPaymentState(current, OCTOBER).expectedNowPYG, 0);
  current = { ...current, payments: [...current.payments, pendingPayment('installment-2')] };
  current = applyPaymentConfirmation(current, {
    paymentId: 'installment-2', paymentType: 'FINAL', verifiedAmountPYG: 100_000,
    timestamp: OCTOBER + 1,
  }).order;
  assert.equal(current.paidAmountPYG, 600_000);
  assert.equal(current.remainingBalancePYG, 1_400_000);
  current = { ...current, payments: [...current.payments, pendingPayment('installment-3')] };
  current = applyPaymentConfirmation(current, {
    paymentId: 'installment-3', paymentType: 'FINAL', verifiedAmountPYG: 1_400_000,
    timestamp: OCTOBER + 2,
  }).order;
  assert.equal(current.paidAmountPYG, 2_000_000);
  assert.equal(current.remainingBalancePYG, 0);
  assert.equal(current.paymentState, 'FULLY_PAID');
  assert.equal(current.status, 'PAID_IN_FULL');
  assert.equal(current.finalPaymentConfirmedAt, OCTOBER + 2);
  assert.deepEqual(current.payments.map(item => item.amountPYG), [500_000, 100_000, 1_400_000]);
});

test('supports a one-step full payment', () => {
  const immediate = routineOrder({
    status: 'RECEIPT_RECEIVED',
    totals: { totalPYG: 250_000, dueNowPYG: 250_000, futureBalancePYG: 0 },
    items: [{ productId: 'immediate', saleMode: 'IMMEDIATE' }],
  });
  const result = confirmRoutine(immediate, 250_000, { paymentType: 'FULL' }).order;
  assert.equal(result.paymentState, 'FULLY_PAID');
  assert.equal(result.status, 'PAYMENT_CONFIRMED');
  assert.equal(result.remainingBalancePYG, 0);
});

test('overpayment requires acknowledgement and preserves the full actual amount', () => {
  assert.throws(() => confirmRoutine(routineOrder(), 2_005_000, { paymentType: 'FULL' }), /sobrepago/i);
  const result = confirmRoutine(routineOrder(), 2_005_000, {
    paymentType: 'FULL', acknowledgeOverpayment: true,
  }).order;
  assert.equal(result.paidAmountPYG, 2_005_000);
  assert.equal(result.netReceivedPYG, 2_005_000);
  assert.equal(result.remainingBalancePYG, 0);
  assert.equal(result.overpaymentPYG, 5_000);
  assert.equal(result.payments[0].overpaymentAcknowledged, true);
});

test('expected-now changes from deposit shortfall to full balance on December 1', () => {
  const paid = confirmRoutine(routineOrder(), 600_000).order;
  assert.equal(withPaymentState(paid, OCTOBER).expectedNowPYG, 0);
  assert.equal(withPaymentState(paid, DECEMBER).expectedNowPYG, 1_400_000);
});

test('active legacy assumed payment blocks confirmation while a voided one does not', () => {
  const legacy = payment({ id: 'legacy', amountPYG: 100_000 });
  const source = routineOrder({ payments: [legacy, pendingPayment()] });
  assert.throws(() => confirmRoutine(source, 500_000), /Reconciliá los pagos históricos/i);
  const voided = routineOrder({ payments: [{ ...legacy, voidedAt: OCTOBER }, pendingPayment()] });
  assert.equal(confirmRoutine(voided, 500_000).order.payments[1].amountSource, 'ADMIN_VERIFIED');
});

test('Esilda refund economics remain fully paid without false overpayment', () => {
  const esilda = withPaymentState({
    id: 'VM-2026-E00AA2E0',
    status: 'PAYMENT_CONFIRMED',
    totals: { totalPYG: 60_000, dueNowPYG: 60_000, futureBalancePYG: 0 },
    items: [{ saleMode: 'IMMEDIATE' }],
    payments: [payment({ type: 'FULL', amountPYG: 60_000, amountSource: 'LEGACY_RECONCILED' })],
    paymentAdjustments: [{ kind: 'POST_SALE_PRICE_ADJUSTMENT', amountPYG: 30_000 }],
  });
  assert.equal(esilda.adjustedOrderTotalPYG, 30_000);
  assert.equal(esilda.netReceivedPYG, 30_000);
  assert.equal(esilda.remainingBalancePYG, 0);
  assert.equal(esilda.overpaymentPYG, 0);
  assert.equal(esilda.paymentState, 'FULLY_PAID');
});

test('voids Liam duplicate without counting it in totals', () => {
  const liam = order({
    id: 'VM-2026-488975E8',
    status: 'PAID_IN_FULL',
    totals: { totalPYG: 1_919_000, dueNowPYG: 479_750, futureBalancePYG: 1_439_250 },
    payments: [
      payment({ id: 'valid-liam', amountPYG: 1_919_000, amountSource: 'LEGACY_RECONCILED' }),
      payment({ id: 'legacy-duplicate', amountPYG: 1_076_250 }),
    ],
  });
  const result = voidDuplicate(liam);
  assert.equal(result.paidAmountPYG, 1_919_000);
  assert.equal(result.remainingBalancePYG, 0);
  assert.equal(result.payments[1].amountPYG, 1_076_250);
  assert.equal(result.payments[1].voidReason, 'DUPLICATE_LEGACY_PAYMENT');
});

test('public payments expose confirmed non-voided date and amount only', () => {
  const source = routineOrder({ payments: [
    {
      ...pendingPayment('confirmed'), amountPYG: 500_000, amountSource: 'ADMIN_VERIFIED',
      verifiedBy: 'ADMIN', verificationStatus: 'CONFIRMED', confirmedAt: OCTOBER,
      partialPaymentApproved: true, exceptionNoteId: 'secret-note',
    },
    pendingPayment('pending'),
    {
      ...pendingPayment('voided'), amountPYG: 10_000, verificationStatus: 'CONFIRMED',
      confirmedAt: OCTOBER, voidedAt: OCTOBER + 1, voidReason: 'DUPLICATE_LEGACY_PAYMENT',
    },
  ] });
  assert.deepEqual(publicPayments(source), [{ id: 'confirmed', amountPYG: 500_000, confirmedAt: OCTOBER }]);
});

test('inventory commit decision is true only for the first non-idempotent confirmation', () => {
  const first = confirmRoutine(routineOrder(), 500_000);
  const retry = confirmRoutine(first.order, 500_000);
  assert.equal(confirmationRequiresInventoryCommit(null, first), true);
  assert.equal(confirmationRequiresInventoryCommit(OCTOBER, first), false);
  assert.equal(confirmationRequiresInventoryCommit(null, retry), false);
});
