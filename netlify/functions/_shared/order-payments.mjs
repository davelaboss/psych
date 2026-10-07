const CONFIRMED_STATUSES = new Set([
  'PAYMENT_CONFIRMED',
  'DEPOSIT_CONFIRMED',
  'PAID_IN_FULL',
  'READY_TO_SCHEDULE',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
]);

const COMPLETED_STATUSES = new Set(['PICKED_UP', 'CANCELLED']);
const DELAYED_FINAL_PAYMENT_START = Date.parse('2026-12-01T00:00:00-03:00');
const PAYMENT_TYPES = new Set(['DEPOSIT', 'FULL', 'FINAL']);
const NOTE_KINDS = new Set(['EXCEPTION', 'ARRANGEMENT', 'LEGACY_RECONCILIATION']);
const LEGACY_RECONCILIATION_SOURCES = new Map([
  ['ACTUAL_VERIFIED', 'LEGACY_RECONCILED'],
  ['SELLER_APPROVED_CREDIT', 'LEGACY_OPENING_CREDIT'],
]);

function paymentError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function pyg(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
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

export function derivePaymentState(order, now = Date.now()) {
  const payments = orderPayments(order);
  const confirmedPaidPYG = payments.reduce((sum, payment) => {
    if (payment.verificationStatus !== 'CONFIRMED') return sum;
    const next = sum + pyg(payment.amountPYG);
    if (!Number.isSafeInteger(next)) throw paymentError('El total confirmado excede el límite seguro.', 409);
    return next;
  }, 0);
  const totalPYG = pyg(order?.totals?.totalPYG);
  const dueNowPYG = Math.min(totalPYG, pyg(order?.totals?.dueNowPYG));
  const remainingBalancePYG = Math.max(0, totalPYG - confirmedPaidPYG);
  const depositShortfallPYG = Math.max(0, dueNowPYG - confirmedPaidPYG);
  const overpaymentPYG = Math.max(0, confirmedPaidPYG - totalPYG);
  const delayed = Boolean(order?.items?.some(item => item.saleMode === 'DELAYED'));
  const expectedNowPYG = delayed && Number(now) < DELAYED_FINAL_PAYMENT_START
    ? depositShortfallPYG : remainingBalancePYG;
  let paymentState = 'UNPAID';
  if (confirmedPaidPYG >= totalPYG && totalPYG > 0) paymentState = 'FULLY_PAID';
  else if (confirmedPaidPYG > 0 && confirmedPaidPYG < dueNowPYG) paymentState = 'PARTIALLY_PAID';
  else if (dueNowPYG < totalPYG && confirmedPaidPYG >= dueNowPYG && confirmedPaidPYG < totalPYG) {
    paymentState = 'DEPOSIT_SATISFIED';
  } else if (confirmedPaidPYG > 0) paymentState = 'PARTIALLY_PAID';
  const legacyAssumedPaymentIds = payments
    .filter(payment => paymentAmountSource(payment) === 'LEGACY_ASSUMED')
    .map(payment => payment.id);
  return {
    payments,
    confirmedPaidPYG,
    paidAmountPYG: confirmedPaidPYG,
    remainingBalancePYG,
    depositShortfallPYG,
    expectedNowPYG,
    overpaymentPYG,
    paymentState,
    legacyAssumedPaymentIds,
    hasLegacyAssumedPayments: legacyAssumedPaymentIds.length > 0,
  };
}

export function withPaymentState(order, now = Date.now()) {
  if (!order) return order;
  return { ...order, ...derivePaymentState(order, now) };
}

export function confirmationRequiresInventoryCommit(committedAt, confirmationResult) {
  return !committedAt && !confirmationResult?.idempotent;
}

function nextOperationalStatus(order, paymentState) {
  if (COMPLETED_STATUSES.has(order.status)) return order.status;
  if (paymentState !== 'FULLY_PAID') return 'DEPOSIT_CONFIRMED';
  return order.items?.some(item => item.saleMode === 'DELAYED')
    ? 'PAID_IN_FULL' : 'PAYMENT_CONFIRMED';
}

export function appendPaymentNote(order, {
  kind,
  text,
  relatedPaymentId = null,
  timestamp = Date.now(),
  noteId = crypto.randomUUID(),
}) {
  const normalizedKind = String(kind || '').trim().toUpperCase();
  if (!NOTE_KINDS.has(normalizedKind)) throw paymentError('Tipo de nota interna inválido.');
  const note = {
    id: noteId,
    kind: normalizedKind,
    text: normalizedNote(text),
    ...(relatedPaymentId ? { relatedPaymentId: String(relatedPaymentId) } : {}),
    createdAt: Number(timestamp),
    createdBy: 'ADMIN',
  };
  return { ...order, paymentNotes: [...(order.paymentNotes || []), note], updatedAt: Number(timestamp) };
}

export function applyPaymentConfirmation(order, {
  paymentId,
  paymentType,
  verifiedAmountPYG,
  approvePartialPayment = false,
  acknowledgeOverpayment = false,
  internalNote = '',
  timestamp = Date.now(),
  noteId,
}) {
  const current = withPaymentState(order, timestamp);
  const id = String(paymentId || '').trim();
  if (!id) throw paymentError('Falta el identificador exacto del pago.');
  const type = String(paymentType || '').trim().toUpperCase();
  if (!PAYMENT_TYPES.has(type)) throw paymentError('Tipo de pago inválido.');
  const amount = parseVerifiedAmountPYG(verifiedAmountPYG);
  const index = current.payments.findIndex(payment => payment.id === id);
  if (index < 0) throw paymentError('No encontramos el pago indicado.', 409);
  const existing = current.payments[index];
  if (existing.verificationStatus === 'CONFIRMED') {
    if (existing.type !== type) throw paymentError('Este pago ya fue confirmado con otra clasificación.', 409);
    if (pyg(existing.amountPYG) !== amount) throw paymentError('Este pago ya fue confirmado con otro importe.', 409);
    return { order: current, idempotent: true, previousConfirmedPaidPYG: current.confirmedPaidPYG };
  }
  if (existing.verificationStatus !== 'PENDING') throw paymentError('El pago indicado no está pendiente.', 409);
  if (current.hasLegacyAssumedPayments) {
    throw paymentError('Reconciliá los pagos históricos antes de confirmar un nuevo importe.', 409);
  }

  const resultingPaidPYG = current.confirmedPaidPYG + amount;
  const dueNowPYG = pyg(current.totals?.dueNowPYG);
  const totalPYG = pyg(current.totals?.totalPYG);
  const shortfall = resultingPaidPYG < dueNowPYG;
  const overpayment = resultingPaidPYG > totalPYG;
  if (shortfall && !approvePartialPayment) {
    throw paymentError('La seña o el importe requerido queda incompleto. Debés aprobar expresamente el pago parcial.', 409);
  }
  if (shortfall) normalizedNote(internalNote);
  if (overpayment && !acknowledgeOverpayment) {
    throw paymentError('El importe supera el saldo pendiente. Confirmá expresamente el sobrepago.', 409);
  }
  const exceptionNoteId = shortfall ? (noteId || crypto.randomUUID()) : null;

  const payments = current.payments.map((payment, paymentIndex) => paymentIndex === index
    ? {
        ...payment,
        type,
        amountPYG: amount,
        amountSource: 'ADMIN_VERIFIED',
        verifiedBy: 'ADMIN',
        verificationStatus: 'CONFIRMED',
        confirmedAt: Number(timestamp),
        ...(shortfall ? { partialPaymentApproved: true, exceptionNoteId } : {}),
        ...(overpayment ? { overpaymentAcknowledged: true } : {}),
      }
    : payment);
  let next = withPaymentState({ ...current, payments }, timestamp);
  next = {
    ...next,
    status: nextOperationalStatus(current, next.paymentState),
    initialPaymentConfirmedAt: current.initialPaymentConfirmedAt || Number(timestamp),
    ...(next.paymentState === 'FULLY_PAID' && current.confirmedPaidPYG > 0
      ? { finalPaymentConfirmedAt: Number(timestamp) } : {}),
    updatedAt: Number(timestamp),
  };
  if (shortfall) {
    next = appendPaymentNote(next, {
      kind: 'EXCEPTION',
      text: internalNote,
      relatedPaymentId: id,
      timestamp,
      noteId: exceptionNoteId,
    });
  }
  return {
    order: withPaymentState(next, timestamp),
    idempotent: false,
    previousConfirmedPaidPYG: current.confirmedPaidPYG,
  };
}

export function reconcileLegacyPayment(order, {
  paymentId,
  reconciledAmountPYG,
  basis,
  internalNote,
  timestamp = Date.now(),
  noteId,
}) {
  const current = withPaymentState(order, timestamp);
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
    throw paymentError('Este pago ya fue reconciliado.', 409);
  }
  const payments = current.payments.map((payment, paymentIndex) => paymentIndex === index
    ? {
        ...payment,
        amountPYG: amount,
        amountSource: source,
        verifiedBy: 'ADMIN',
        legacyAssumedAmountPYG: pyg(payment.amountPYG),
        reconciledAt: Number(timestamp),
        reconciledBy: 'ADMIN',
      }
    : payment);
  let next = withPaymentState({ ...current, payments }, timestamp);
  next = {
    ...next,
    status: nextOperationalStatus(current, next.paymentState),
    updatedAt: Number(timestamp),
  };
  next = appendPaymentNote(next, {
    kind: 'LEGACY_RECONCILIATION',
    text: note,
    relatedPaymentId: id,
    timestamp,
    ...(noteId ? { noteId } : {}),
  });
  return withPaymentState(next, timestamp);
}

export function publicPayments(order) {
  return orderPayments(order)
    .filter(payment => payment.verificationStatus === 'CONFIRMED')
    .map(payment => ({
      id: payment.id,
      amountPYG: pyg(payment.amountPYG),
      confirmedAt: payment.confirmedAt || null,
    }));
}
