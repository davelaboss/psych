import {
  adminAuthorized,
  commitInventoryHold,
  getOrder,
  jsonResponse,
} from './_shared/commerce.mjs';


export default async function handler(request) {
  if (!adminAuthorized(request)) {
    return jsonResponse(
      { error: 'Acceso no autorizado.' },
      401
    );
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  try {
    const body =
      await request.json();

    const orderId =
      String(
        body?.orderId || ''
      ).trim();

    const order =
      await getOrder(orderId);

    if (!order) {
      return jsonResponse(
        {
          error:
            'Pedido no encontrado.',
        },
        404
      );
    }

    if (
      ![
        'RECEIPT_RECEIVED',
        'VERIFYING_PAYMENT',
        'PAYMENT_CONFIRMED',
        'DEPOSIT_CONFIRMED',
      ].includes(order.status)
    ) {
      return jsonResponse(
        {
          error:
            'Este pedido no está esperando confirmación de pago.',
        },
        409
      );
    }

    const committed =
      await commitInventoryHold(
        orderId
      );

    if (!committed) {
      return jsonResponse(
        {
          error:
            'No encontramos la reserva de inventario de este pedido.',
        },
        409
      );
    }

    const updated = await getOrder(orderId);

    const safeOrder = {
      ...updated,
    };

    delete safeOrder.accessTokenHash;

    return jsonResponse({
      ok: true,
      order: safeOrder,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo confirmar el pago.',
      },
      400
    );
  }
}
