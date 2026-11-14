import { timingKeyForItem, timingLabel } from './fulfillment-batches-core.mjs';
import { withPaymentState } from './order-payments.mjs';
import { itemPaymentEligibility } from './item-payment-eligibility.mjs';

export const SCHEDULABLE_ORDER_STATUSES = Object.freeze([
  'AWAITING_INITIAL_PAYMENT', 'RECEIPT_RECEIVED', 'VERIFYING_PAYMENT',
  'DEPOSIT_CONFIRMED', 'FINAL_RECEIPT_RECEIVED', 'PAYMENT_CONFIRMED',
  'PAID_IN_FULL', 'READY_TO_SCHEDULE', 'PICKUP_SCHEDULED',
]);

export function orderSchedulingEligible(order, now = Date.now()) {
  if (!SCHEDULABLE_ORDER_STATUSES.includes(order?.status) || order.reservationState === 'EXPIRED') return false;
  // Booking never renews an unpaid hold. Protected/committed orders have no deadline.
  return order.status !== 'AWAITING_INITIAL_PAYMENT' || !order.holdExpiresAt ||
    Number(order.holdExpiresAt) > Number(now);
}

const pyg = value => {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
};

export function deriveOrderFulfillmentParts(order, decisions = []) {
  const current = withPaymentState(order);
  if (!current) return [];
  const groups = new Map();
  const funding = new Map(itemPaymentEligibility(current, decisions).map(item => [item.productId, item]));
  for (const item of Array.isArray(current.items) ? current.items : []) {
    const timingKey = timingKeyForItem(item);
    const part = groups.get(timingKey) || {
      timingKey,
      timingLabel: timingLabel(timingKey),
      items: [],
      itemIds: [],
      itemTotalPYG: 0,
      dueNowPYG: 0,
      futureBalancePYG: 0,
      pickupWindow: timingKey === 'IMMEDIATE' ? null : {
        startDate: item.pickupWindowStart || null,
        endDate: item.pickupWindowEnd || null,
      },
    };
    part.items.push(item);
    part.itemIds.push(item.productId);
    const quantity = Math.max(1, pyg(item.quantity));
    const storedItemTotal = pyg(item.unitPricePYG) * quantity;
    part.itemTotalPYG += storedItemTotal || pyg(item.dueNowPYG) + pyg(item.futureBalancePYG);
    part.dueNowPYG += pyg(item.dueNowPYG);
    part.futureBalancePYG += pyg(item.futureBalancePYG);
    groups.set(timingKey, part);
  }
  return [...groups.values()].map(part => {
    const itemEligibility = part.items.map(item => ({ ...funding.get(item.productId),
      schedulingEligible: orderSchedulingEligible(current) && Boolean(funding.get(item.productId)?.schedulingEligible) }));
    const handoverEligible = current.status !== 'CANCELLED' && itemEligibility.every(item => item.handoverEligible);
    const status = current.status === 'CANCELLED' ? 'CANCELLED' : handoverEligible ? 'READY_FOR_PICKUP' :
      part.timingKey === 'IMMEDIATE' ? 'WAITING_FOR_CURRENT_PAYMENT' : 'WAITING_FOR_FINAL_PAYMENT';
    return {
      ...part,
      eligible: handoverEligible,
      handoverEligible,
      itemEligibility,
      schedulableItemIds: itemEligibility.filter(item => item.schedulingEligible).map(item => item.productId),
      schedulingEligible: itemEligibility.some(item => item.schedulingEligible),
      status,
      orderRemainingBalancePYG: pyg(current.remainingBalancePYG),
    };
  });
}

export function orderFulfillmentPart(order, timingKey, decisions = []) {
  return deriveOrderFulfillmentParts(order, decisions).find(part => part.timingKey === timingKey) || null;
}
