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

export function paymentAmountSource(payment) {
  if (payment?.verificationStatus !== 'CONFIRMED') return null;
  return payment.amountSource || 'LEGACY_ASSUMED';
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
  const paidAmountPYG = payments.reduce((sum, payment) => payment.verificationStatus === 'CONFIRMED'
    ? sum + Number(payment.amountPYG || 0) : sum, 0);
  const total = Number(order.totals?.totalPYG || 0);
  return {
    ...order,
    payments,
    paidAmountPYG,
    remainingBalancePYG: Math.max(0, total - paidAmountPYG),
  };
}

function reconciledOperationalStatus(order, remainingBalancePYG) {
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
  next = {
    ...next,
    status: reconciledOperationalStatus(current, next.remainingBalancePYG),
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

export function publicPayments(order) {
  return orderPayments(order).map(payment => ({
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
