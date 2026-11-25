import {
  adminAuthorized,
  jsonResponse,
  listOrders,
} from './_shared/commerce.mjs';
import { database } from './_shared/inventory-database.mjs';
import { normalizeProductId, orderItems } from './_shared/fulfillment-batches-core.mjs';
import { randomUUID } from 'node:crypto';

export async function fullyDeliveredOrderIds(orders, client = database().pool) {
  if (!orders.length) return new Set();
  // Read existing assignments only: listing orders must not create or update batches.
  const { rows } = await client.query(`SELECT membership.order_id, membership.product_id
    FROM fulfillment_batch_items membership
    JOIN fulfillment_batches batch USING (fulfillment_batch_id)
    WHERE membership.order_id = ANY($1::text[])
      AND batch.status = 'DELIVERED' AND batch.merged_into_batch_id IS NULL`,
  [orders.map(order => order.id)]);
  const delivered = new Set(rows.map(row => JSON.stringify([row.order_id, row.product_id])));
  return new Set(orders.filter(order => {
    const items = orderItems(order);
    return items.length > 0 && items.every(item => {
      const productId = normalizeProductId(item?.productId);
      return productId && delivered.has(JSON.stringify([order.id, productId]));
    });
  }).map(order => order.id));
}


export default async function handler(request) {
  if (!await adminAuthorized(request)) {
    return jsonResponse(
      { error: 'Acceso no autorizado.' },
      401
    );
  }

  if (request.method !== 'GET') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  const orders =
    await listOrders();
  let deliveredOrderIds;
  try {
    deliveredOrderIds = await fullyDeliveredOrderIds(orders);
  } catch (error) {
    const errorReference = `PEDIDOS-${randomUUID()}`;
    console.error('ADMIN_ORDERS_DELIVERY_LOOKUP_FAILED', {
      errorReference,
      code: typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : 'UNKNOWN',
    });
    return jsonResponse({
      error: `No se pudo verificar el estado de entrega de los pedidos. Intentá nuevamente. Referencia: ${errorReference}.`,
      code: 'ORDER_DELIVERY_LOOKUP_FAILED',
      errorReference,
    }, 503);
  }

  return jsonResponse({
    ok: true,

    orders: orders.map(
      (order) => ({
        id: order.id,

        createdAt:
          order.createdAt,

        updatedAt:
          order.updatedAt,

        status:
          order.status,

        fullyDelivered: deliveredOrderIds.has(order.id),
        hasPendingPayment: order.payments.some(payment => payment.verificationStatus === 'PENDING'),

        holdExpiresAt:
          order.holdExpiresAt || null,

        reservationState:
          order.reservationState || null,

        buyer: {
          name:
            order.buyer?.name || '',

          phone:
            order.buyer?.phone || '',

          email:
            order.buyer?.email || '',
        },

        totals:
          order.totals,

        paidAmountPYG:
          order.paidAmountPYG,

        remainingBalancePYG:
          order.remainingBalancePYG,

        itemCount:
          (order.items || []).reduce(
            (sum, item) =>
              sum +
              Number(item.quantity || 0),
            0
          ),

        hasReceipt:
          order.payments.some(payment => Boolean(payment.receipt)),
      })
    ),
  });
}
