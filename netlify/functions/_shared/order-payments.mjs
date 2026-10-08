const CONFIRMED_STATUSES = new Set([
  'PAYMENT_CONFIRMED',
  'DEPOSIT_CONFIRMED',
  'PAID_IN_FULL',
  'READY_TO_SCHEDULE',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
]);

const COMPLETED_STATUSES = new Set(['PICKED_UP', 'CANCELLED']);
const PAID_OPERATIONAL_STATUSES = new Set(['READY_TO_SCHEDULE', 'PICKUP_SCHEDULED']);
const LEGACY_RECONCILIATION_SOURCES = new Map([
  ['ACTUAL_VERIFIED', 'LEGACY_RECONCILED'],
  ['SELLER_APPROVED_CREDIT', 'LEGACY_OPENING_CREDIT'],
]);
const LEGACY_HISTORICAL_SOURCES = new Set([
  'LEGACY_ASSUMED',
  'LEGACY_RECONCILED',
  'LEGACY_OPENING_CREDIT',
]);
const POST_SALE_PRICE_ADJUSTMENT = 'POST_SALE_PRICE_ADJUSTMENT';

function paymentError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function normalizedNote(text) {
  const note = String(text || '').trim();
  if (!note) throw paymentError('La nota interna es obligatoria.');
  if (note.length > 2000) throw paymentError('La nota interna no puede superar 2.000 caracteres.');
  return note;
}

export function parseVerifiedAmountPYG(value) {
  if (value === '' || value == null) throw paymentError('Ingresá el importe verificado.');
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    throw paymentError('El importe debe ser un número entero de guaraníes.');
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw paymentError('El importe debe ser un entero seguro.');
  if (amount <= 0) throw paymentError('El importe verificado debe ser mayor que cero.');
  return amount;
}

export function parsePaymentAdjustmentAmountPYG(value) {
  if (value === '' || value == null) throw paymentError('Ingresá el importe del ajuste.');
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    throw paymentError('El importe del ajuste debe ser un número entero de guaraníes.');
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw paymentError('El importe del ajuste debe ser un entero seguro.');
  if (amount <= 0) throw paymentError('El importe del ajuste debe ser mayor que cero.');
  return amount;
}

export function paymentAmountSource(payment) {
  if (payment?.verificationStatus !== 'CONFIRMED') return null;
  return payment.amountSource || 'LEGACY_ASSUMED';
}

function paymentIsVoided(payment) {
  return payment?.voidedAt != null;
}

function paymentCountsAsConfirmed(payment) {
  return payment?.verificationStatus === 'CONFIRMED' && !paymentIsVoided(payment);
}

function paymentIsHistorical(payment) {
  return LEGACY_HISTORICAL_SOURCES.has(paymentAmountSource(payment));
}

function orderPaymentAdjustments(order) {
  return Array.isArray(order?.paymentAdjustments)
    ? order.paymentAdjustments.map(adjustment => ({ ...adjustment }))
    : [];
}

function adjustmentCountsAsRefund(adjustment) {
  return adjustment?.kind === POST_SALE_PRICE_ADJUSTMENT &&
    Number.isSafeInteger(Number(adjustment.amountPYG)) && Number(adjustment.amountPYG) > 0;
}

function requireRefundCoverage(order) {
  if (order.paidAmountPYG < order.refundedAmountPYG) {
    throw paymentError('El cambio dejaría los reembolsos por encima de los pagos confirmados.', 409);
  }
}

export function orderPayments(order) {
  if (Array.isArray(order?.payments) && (order.payments.length || !order?.receipt)) {
    return order.payments.map(payment => ({ ...payment }));
  }
  if (!order?.receipt) return [];
  const confirmed = Boolean(order.initialPaymentConfirmedAt) || CONFIRMED_STATUSES.has(order.status);
  const delayedDeposit = confirmed && order.status === 'DEPOSIT_CONFIRMED';
  return [{
    id: 'legacy-initial',
    type: confirmed ? (delayedDeposit ? 'DEPOSIT' : 'FULL') : 'PENDING',
    amountPYG: confirmed
      ? Number(delayedDeposit ? order.totals?.dueNowPYG : order.totals?.totalPYG) || 0
      : null,
    amountSource: confirmed ? 'LEGACY_ASSUMED' : undefined,
    receipt: order.receipt,
    submittedAt: order.receipt.uploadedAt || order.updatedAt || order.createdAt,
    submittedBy: order.receipt.uploadedBy || 'CUSTOMER',
    paymentMethod: 'BANK_TRANSFER',
    verificationStatus: confirmed ? 'CONFIRMED' : 'PENDING',
    confirmedAt: confirmed ? order.initialPaymentConfirmedAt || order.updatedAt : null,
  }];
}

export function withPaymentState(order) {
  if (!order) return order;
  const payments = orderPayments(order);
  const paymentAdjustments = orderPaymentAdjustments(order);
  const paidAmountPYG = payments.reduce((sum, payment) => paymentCountsAsConfirmed(payment)
    ? sum + Number(payment.amountPYG || 0) : sum, 0);
  const grossOrderTotalPYG = Number(order.totals?.totalPYG || 0);
  const refundedAmountPYG = paymentAdjustments.reduce((sum, adjustment) =>
    adjustmentCountsAsRefund(adjustment) ? sum + Number(adjustment.amountPYG) : sum, 0);
  const adjustedOrderTotalPYG = Math.max(0, grossOrderTotalPYG - refundedAmountPYG);
  const netReceivedPYG = paidAmountPYG - refundedAmountPYG;
  return {
    ...order,
    payments,
    paymentAdjustments,
    grossOrderTotalPYG,
    paidAmountPYG,
    refundedAmountPYG,
    adjustedOrderTotalPYG,
    netReceivedPYG,
    remainingBalancePYG: Math.max(0, adjustedOrderTotalPYG - netReceivedPYG),
  };
}

function adjustedOperationalStatus(order, remainingBalancePYG) {
  if (COMPLETED_STATUSES.has(order.status)) return order.status;
  if (remainingBalancePYG > 0) return 'DEPOSIT_CONFIRMED';
  if (PAID_OPERATIONAL_STATUSES.has(order.status)) return order.status;
  return order.items?.some(item => item.saleMode === 'DELAYED')
    ? 'PAID_IN_FULL' : 'PAYMENT_CONFIRMED';
}

export function reconcileLegacyPayment(order, {
  paymentId,
  reconciledAmountPYG,
  basis,
  internalNote,
  timestamp = Date.now(),
  noteId = crypto.randomUUID(),
}) {
  const current = withPaymentState(order);
  const id = String(paymentId || '').trim();
  if (!id) throw paymentError('Falta el pago histórico a reconciliar.');
  const source = LEGACY_RECONCILIATION_SOURCES.get(String(basis || '').trim().toUpperCase());
  if (!source) throw paymentError('Indicá cómo se estableció el importe histórico.');
  const amount = parseVerifiedAmountPYG(reconciledAmountPYG);
  const note = normalizedNote(internalNote);
  const index = current.payments.findIndex(payment => payment.id === id);
  if (index < 0) throw paymentError('No encontramos el pago histórico.', 409);
  const existing = current.payments[index];
  if (paymentIsVoided(existing)) {
    throw paymentError('Este pago histórico ya fue anulado.', 409);
  }
  if (paymentAmountSource(existing) !== 'LEGACY_ASSUMED') {
    throw paymentError('Este pago no es un pago histórico pendiente de reconciliación.', 409);
  }
  const assumedAmount = Number(existing.amountPYG);
  if (!Number.isSafeInteger(assumedAmount) || assumedAmount < 0) {
    throw paymentError('El importe histórico almacenado no es válido.', 409);
  }

  const payments = current.payments.map((payment, paymentIndex) => paymentIndex === index
    ? {
        ...payment,
        amountPYG: amount,
        amountSource: source,
        verifiedBy: 'ADMIN',
        legacyAssumedAmountPYG: assumedAmount,
        reconciledAt: Number(timestamp),
        reconciledBy: 'ADMIN',
      }
    : payment);
  let next = withPaymentState({ ...current, payments });
  requireRefundCoverage(next);
  next = {
    ...next,
    status: adjustedOperationalStatus(current, next.remainingBalancePYG),
    paymentNotes: [...(current.paymentNotes || []), {
      id: noteId,
      kind: 'LEGACY_RECONCILIATION',
      text: note,
      relatedPaymentId: id,
      createdAt: Number(timestamp),
      createdBy: 'ADMIN',
    }],
    updatedAt: Number(timestamp),
  };
  return withPaymentState(next);
}

export function voidLegacyDuplicatePayment(order, {
  paymentId,
  internalNote,
  timestamp = Date.now(),
  noteId = crypto.randomUUID(),
}) {
  const current = withPaymentState(order);
  const id = String(paymentId || '').trim();
  if (!id) throw paymentError('Falta el pago histórico a anular.');
  const note = normalizedNote(internalNote);
  const index = current.payments.findIndex(payment => payment.id === id);
  if (index < 0) throw paymentError('No encontramos el pago histórico.', 409);
  const existing = current.payments[index];
  if (existing.verificationStatus !== 'CONFIRMED') {
    throw paymentError('Solo se puede anular un pago histórico confirmado.', 409);
  }
  if (paymentIsVoided(existing)) {
    throw paymentError('Este pago histórico ya fue anulado.', 409);
  }
  if (!paymentIsHistorical(existing)) {
    throw paymentError('Este pago no es un pago histórico que pueda anularse.', 409);
  }
  const hasAnotherConfirmedPayment = current.payments.some((payment, paymentIndex) =>
    paymentIndex !== index && paymentCountsAsConfirmed(payment));
  if (!hasAnotherConfirmedPayment) {
    throw paymentError('No se puede anular el único pago confirmado del pedido.', 409);
  }

  const payments = current.payments.map((payment, paymentIndex) => paymentIndex === index
    ? {
        ...payment,
        voidedAt: Number(timestamp),
        voidedBy: 'ADMIN',
        voidReason: 'DUPLICATE_LEGACY_PAYMENT',
        voidNoteId: noteId,
      }
    : payment);
  let next = withPaymentState({ ...current, payments });
  requireRefundCoverage(next);
  next = {
    ...next,
    status: adjustedOperationalStatus(current, next.remainingBalancePYG),
    paymentNotes: [...(current.paymentNotes || []), {
      id: noteId,
      kind: 'LEGACY_PAYMENT_VOID',
      text: note,
      relatedPaymentId: id,
      createdAt: Number(timestamp),
      createdBy: 'ADMIN',
    }],
    updatedAt: Number(timestamp),
  };
  return withPaymentState(next);
}

export function recordPostSalePriceAdjustment(order, {
  kind,
  amountPYG,
  internalNote,
  timestamp = Date.now(),
  adjustmentId = crypto.randomUUID(),
}) {
  const current = withPaymentState(order);
  if (String(kind || '').trim() !== POST_SALE_PRICE_ADJUSTMENT) {
    throw paymentError('El tipo de ajuste posterior a la venta no es válido.');
  }
  const amount = parsePaymentAdjustmentAmountPYG(amountPYG);
  const note = normalizedNote(internalNote);
  if (current.status === 'CANCELLED') {
    throw paymentError('No se puede registrar un ajuste en un pedido cancelado.', 409);
  }
  if (!current.payments.some(payment => paymentCountsAsConfirmed(payment) &&
      Number.isSafeInteger(Number(payment.amountPYG)) && Number(payment.amountPYG) > 0)) {
    throw paymentError('El pedido no tiene un pago confirmado para reembolsar.', 409);
  }
  const safeRefundableAmountPYG = Math.max(0,
    Math.min(current.adjustedOrderTotalPYG, current.netReceivedPYG));
  if (amount > safeRefundableAmountPYG) {
    throw paymentError('El ajuste supera el importe que se puede reembolsar.', 409);
  }

  return withPaymentState({
    ...current,
    paymentAdjustments: [...current.paymentAdjustments, {
      id: adjustmentId,
      kind: POST_SALE_PRICE_ADJUSTMENT,
      amountPYG: amount,
      createdAt: Number(timestamp),
      createdBy: 'ADMIN',
      internalNote: note,
    }],
    updatedAt: Number(timestamp),
  });
}

export function publicPayments(order) {
  return orderPayments(order).filter(payment => !paymentIsVoided(payment)).map(payment => ({
    id: payment.id,
    type: payment.type,
    amountPYG: payment.amountPYG,
    submittedAt: payment.submittedAt,
    paymentMethod: payment.paymentMethod,
    verificationStatus: payment.verificationStatus,
    confirmedAt: payment.confirmedAt || null,
    receipt: payment.receipt ? {
      fileName: payment.receipt.fileName,
      contentType: payment.receipt.contentType,
      uploadedAt: payment.receipt.uploadedAt,
    } : null,
  }));
}
