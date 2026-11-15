// Pure evaluation of frozen Item terms and explicit Admin decisions. Never use
// catalog prices, order status as proof of funds, or free-text exception notes.
export const validPYG = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const activeDecisions = events => {
  const reversed = new Set(events.filter(e => ['REVERSE', 'REVOKE'].includes(e.kind)).map(e => e.reverses_id));
  return events.filter(e => !reversed.has(e.id) && ['ALLOCATE', 'REQUIREMENT'].includes(e.kind));
};
export function verifiedPayment(payment, { credit = false } = {}) {
  return payment?.verificationStatus === 'CONFIRMED' && payment.voidedAt == null &&
    payment.verifiedBy === 'ADMIN' && validPYG(payment.amountPYG) && payment.amountPYG > 0 &&
    (['ADMIN_VERIFIED', 'LEGACY_RECONCILED'].includes(payment.amountSource) ||
      (credit && payment.amountSource === 'LEGACY_OPENING_CREDIT'));
}
const sum = amounts => {
  const value = amounts.reduce((a, b) => a + b, 0);
  return Number.isSafeInteger(value) ? value : NaN;
};
export function itemPaymentEligibility(order, events = []) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const payments = Array.isArray(order?.payments) ? order.payments : [];
  const active = activeDecisions(events);
  const allocations = active.filter(e => e.kind === 'ALLOCATE');
  const adjustments = order?.paymentAdjustments || [];
  const knownRefunds = adjustments.every(a => a.kind === 'POST_SALE_PRICE_ADJUSTMENT' && validPYG(a.amountPYG));
  const refund = sum(adjustments.map(a => validPYG(a.amountPYG) ? a.amountPYG : 0));
  const ambiguousRefund = !knownRefunds || (items.length !== 1 && adjustments.length > 0);
  const paymentIds = payments.map(p => p.id);
  const uniquePayments = paymentIds.every(id => typeof id === 'string' && id) && new Set(paymentIds).size === paymentIds.length;
  const itemIds = items.map(i => i.productId);
  const uniqueItems = itemIds.every(id => typeof id === 'string' && id) && new Set(itemIds).size === itemIds.length;
  const byPayment = new Map(payments.map(p => [p.id, p]));
  const invalidAllocations = allocations.filter(a => {
    const payment = byPayment.get(a.payment_id);
    return !verifiedPayment(payment, { credit: true }) || !itemIds.includes(a.product_id) ||
      !validPYG(Number(a.amount_pyg)) || Number(a.amount_pyg) <= 0 ||
      !Number.isSafeInteger(sum(allocations.filter(b => b.payment_id === a.payment_id).map(b => Number(b.amount_pyg)))) ||
      sum(allocations.filter(b => b.payment_id === a.payment_id).map(b => Number(b.amount_pyg))) > payment.amountPYG;
  });
  return items.map(item => {
    const decision = active.find(e => e.kind === 'REQUIREMENT' && e.product_id === item.productId);
    // Stored due-now and future-balance are line amounts, already rounded and
    // quantity-adjusted when accepted. Never multiply the deposit again.
    const validTerms = validPYG(item.dueNowPYG) && validPYG(item.futureBalancePYG) &&
      Number.isSafeInteger(item.dueNowPYG + item.futureBalancePYG);
    const total = validTerms ? item.dueNowPYG + item.futureBalancePYG : null;
    let schedule = validTerms ? (String(item.saleMode).trim().toUpperCase() === 'DELAYED' ? item.dueNowPYG : total) : null;
    let collection = total;
    if (decision) {
      schedule = Number(decision.scheduling_required_pyg);
      collection = Number(decision.collection_required_pyg);
    } else if (items.length === 1 && knownRefunds && validTerms) {
      collection = Math.max(0, total - refund);
      schedule = Math.min(schedule, collection);
    }
    const automatic = items.length === 1 && !allocations.length;
    const funded = automatic
      ? sum(payments.filter(p => verifiedPayment(p)).map(p => p.amountPYG))
      : sum(allocations.filter(a => a.product_id === item.productId).map(a => Number(a.amount_pyg)));
    const fundedNet = items.length === 1 ? Math.max(0, funded - refund) : funded;
    const reviewRequired = !uniqueItems || !uniquePayments || invalidAllocations.some(a => a.product_id === item.productId) || ambiguousRefund ||
      !Number.isSafeInteger(refund) || refund > funded || (!decision && total != null && refund > total) ||
      !Number.isSafeInteger(fundedNet) || !validPYG(schedule) || !validPYG(collection) || collection < schedule;
    const schedulingEligible = !reviewRequired && fundedNet >= schedule;
    return { productId: item.productId, requiredPYG: schedule, collectionRequiredPYG: collection,
      fundedPYG: fundedNet, schedulingEligible,
      handoverEligible: !reviewRequired && fundedNet >= collection,
      reviewRequired, source: decision ? 'ADMIN_EXCEPTION' : automatic ? 'SINGLE_ITEM' : 'EXPLICIT_ALLOCATION',
      reason: reviewRequired ? 'OWNER_REVIEW_REQUIRED' : schedulingEligible ? 'PAYMENT_SATISFIED' :
        items.length > 1 ? 'ITEM_ALLOCATION_REQUIRED' : 'ADMIN_CONFIRMATION_REQUIRED' };
  });
}
