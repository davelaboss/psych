import { database, inventoryTransaction, orderLock, confirmLockedOrderPayment } from './inventory-database.mjs';
import { withPaymentState } from './order-payments.mjs';

export const ORDER_ID = 'VM-2026-96200FE0';
export const CORRECTION_ID = 'marketplace-96200fe0-v1';
const KEEP = 'real-202610-volume4-369';
const ORIGINAL = new Map([
  [KEEP, 17500], ['real-202610-volume4-402', 40000],
  ['real-202610-volume4-454', 14000], ['real-202611-volume6-643', 7200],
]);
const fail = () => Object.assign(new Error('El pedido cambió. Detené la corrección y solicitá una nueva revisión.'), { status: 409 });

async function context(client, row, reservations) {
  const products = (await client.query('SELECT * FROM operational_inventory WHERE product_id=ANY($1::text[]) ORDER BY product_id', [[...ORIGINAL.keys()]])).rows;
  const related = (await client.query(`SELECT
    EXISTS(SELECT 1 FROM pickup_appointments WHERE order_id=$1) AS pickup,
    EXISTS(SELECT 1 FROM fulfillment_batch_items WHERE order_id=$1) AS fulfillment`, [ORDER_ID])).rows[0];
  const decisions = (await client.query('SELECT 1 FROM item_payment_decisions WHERE order_id=$1 LIMIT 1', [ORDER_ID])).rows.length;
  return { row, reservations, products, related, decisions };
}

function validateInitial({ row, reservations, products, related, decisions }) {
  if (!row || row.order_id !== ORDER_ID) throw fail();
  const o = withPaymentState(row.order_snapshot);
  const payment = o.payments?.[0];
  if (Number(row.projection_version) !== 2 || row.committed_at || row.expires_at ||
      o.id !== ORDER_ID || o.status !== 'RECEIPT_RECEIVED' || o.reservationState !== 'PROTECTED' ||
      o.holdExpiresAt != null || o.pickup || o.initialPaymentConfirmedAt ||
      o.paidAmountPYG !== 0 || o.paymentAdjustments.length || o.orderCorrections?.length ||
      o.totals?.totalPYG !== 78700 || o.totals.dueNowPYG !== 78700 || o.totals.futureBalancePYG !== 0 ||
      o.items?.length !== 4 || new Set(o.items.map(i => i.productId)).size !== 4 ||
      o.items.some(i => ORIGINAL.get(i.productId) !== i.unitPricePYG || i.quantity !== 1 ||
        i.saleMode !== 'IMMEDIATE' || i.depositPercent !== 100 || i.dueNowPYG !== i.unitPricePYG || i.futureBalancePYG !== 0) ||
      o.payments.length !== 1 || payment.verificationStatus !== 'PENDING' || payment.type !== 'PENDING' ||
      payment.amountPYG != null || payment.confirmedAt != null || payment.voidedAt != null ||
      !payment.id || !payment.receipt?.storageKey || !o.receipt ||
      JSON.stringify(o.receipt) !== JSON.stringify(payment.receipt) ||
      reservations.length !== 4 || new Set(reservations.map(r => r.product_id)).size !== 4 ||
      reservations.some(r => !ORIGINAL.has(r.product_id) || r.order_id !== ORDER_ID ||
        r.quantity !== 1 || r.phase !== 'ORDER' || r.expires_at != null) ||
      products.length !== 4 || products.some(p => !ORIGINAL.has(p.product_id) ||
        p.capacity !== 1 || p.committed_quantity !== 0 || p.owner_withdrawal) ||
      related.pickup || related.fulfillment || decisions) throw fail();
  return o;
}

export async function previewMarketplaceCorrection(client = database().pool) {
  const row = (await client.query('SELECT * FROM checkout_attempts WHERE order_id=$1', [ORDER_ID])).rows[0];
  const reservations = (await client.query('SELECT * FROM inventory_reservations WHERE order_id=$1 ORDER BY product_id', [ORDER_ID])).rows;
  const order = validateInitial(await context(client, row, reservations));
  return { orderId: ORDER_ID, correctionId: CORRECTION_ID, expectedVersion: 2,
    paymentId: order.payments[0].id, originalTotalPYG: 78700, correctedTotalPYG: 30000,
    keepItem: 369, removeItems: [402, 454, 643], verifiedAmountPYG: 30000,
    notifications: false, delivery: false };
}

export async function correctMarketplaceOrder(input) {
  if (input?.action !== 'CORRECT_AND_CONFIRM' || input.expectedVersion !== 2 ||
      input.verifiedAmountPYG !== 30000 || typeof input.paymentId !== 'string' || !input.paymentId ||
      typeof input.approvalReference !== 'string' || !input.approvalReference.trim() || input.approvalReference.length > 500) {
    throw Object.assign(new Error('Falta la aprobación exacta de la corrección y del pago de Gs. 30.000.'), { status: 400 });
  }
  return inventoryTransaction(async client => {
    const locked = await orderLock(client, ORDER_ID);
    if (!locked) throw fail();
    const { row } = locked;
    const prior = row.order_snapshot.orderCorrections?.find(c => c.id === CORRECTION_ID);
    if (prior) {
      const o = withPaymentState(row.order_snapshot);
      const p = o.payments.find(p => p.id === input.paymentId);
      if (prior.paymentId !== input.paymentId || !row.committed_at || o.items.length !== 1 ||
          o.items[0].productId !== KEEP || o.items[0].quantity !== 1 || o.items[0].unitPricePYG !== 30000 ||
          o.totals.totalPYG !== 30000 || o.paidAmountPYG !== 30000 || o.remainingBalancePYG !== 0 ||
          p?.verificationStatus !== 'CONFIRMED' || p.amountSource !== 'ADMIN_VERIFIED' || p.amountPYG !== 30000 ||
          locked.rows.length !== 1 || locked.rows[0].product_id !== KEEP || locked.rows[0].phase !== 'COMMITTED' || locked.rows[0].quantity !== 1) throw fail();
      return { order: o, idempotent: true };
    }
    const original = validateInitial(await context(client, row, locked.rows));
    if (original.payments[0].id !== input.paymentId) throw fail();
    const timestamp = Number(new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0].now));
    const item = { ...original.items.find(i => i.productId === KEEP), unitPricePYG: 30000,
      dueNowPYG: 30000, futureBalancePYG: 0, pricingBasis: 'OWNER_APPROVED_MARKETPLACE' };
    // The accepted Marketplace price is not a liquidation offer. Keep its previous terms in the audit.
    delete item.liquidation;
    const before = structuredClone(row.order_snapshot);
    delete before.accessTokenHash;
    const correction = { id: CORRECTION_ID, actor: 'ADMIN', createdAt: timestamp,
      approvalReference: input.approvalReference.trim(), paymentId: input.paymentId,
      reason: 'Owner-approved Marketplace correction: keep Item 369 at Gs. 30.000; remove Items 402, 454, 643; bank-verified payment Gs. 30.000.',
      originalProjectionVersion: row.projection_version, before,
      after: { items: [item], totals: { totalPYG: 30000, dueNowPYG: 30000, futureBalancePYG: 0 } } };
    const removed = [...ORIGINAL.keys()].filter(id => id !== KEEP);
    const deleted = await client.query("DELETE FROM inventory_reservations WHERE order_id=$1 AND product_id=ANY($2::text[]) AND phase='ORDER' RETURNING product_id", [ORDER_ID, removed]);
    if (deleted.rowCount !== 3) throw fail();
    row.order_snapshot = withPaymentState({ ...original, items: [item], totals: correction.after.totals,
      orderCorrections: [correction], paymentNotes: [...(original.paymentNotes || []), {
        id: CORRECTION_ID, kind: 'ORDER_CORRECTION', relatedPaymentId: input.paymentId,
        text: `${correction.reason} Original total: Gs. 78.700. Approval: ${correction.approvalReference}`,
        createdAt: timestamp, createdBy: 'ADMIN',
      }], updatedAt: timestamp });
    locked.rows = locked.rows.filter(r => r.product_id === KEEP);
    const order = await confirmLockedOrderPayment(client, ORDER_ID, locked, {
      paymentId: input.paymentId, paymentType: 'FULL', verifiedAmountPYG: 30000,
    }, { notify: false });
    if (!order || order.remainingBalancePYG !== 0) throw fail();
    return { order, idempotent: false };
  });
}
