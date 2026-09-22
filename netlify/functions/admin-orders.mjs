import {
  adminAuthorized,
  jsonResponse,
  listOrders,
} from './_shared/commerce.mjs';


export default async function handler(request) {
  if (!adminAuthorized(request)) {
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

        itemCount:
          (order.items || []).reduce(
            (sum, item) =>
              sum +
              Number(item.quantity || 0),
            0
          ),

        hasReceipt:
          Boolean(order.receipt),
      })
    ),
  });
}