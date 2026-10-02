const CONFIRMED_STATUSES = new Set([
  'PAYMENT_CONFIRMED',
  'DEPOSIT_CONFIRMED',
  'PAID_IN_FULL',
  'READY_TO_SCHEDULE',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
]);

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
