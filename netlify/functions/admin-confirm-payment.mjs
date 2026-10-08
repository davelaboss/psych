import {
  adminAuthorized,
  confirmOrderPayment,
  getOrder,
  jsonResponse,
} from './_shared/commerce.mjs';
import { dispatchSellerNotificationsSafely } from './_shared/seller-notifications.mjs';


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

    const paymentId = String(body?.paymentId || '').trim();
    const paymentType = String(body?.paymentType || '').trim().toUpperCase();

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
        'FINAL_RECEIPT_RECEIVED',
        'VERIFYING_PAYMENT',
        'PAYMENT_CONFIRMED',
        'DEPOSIT_CONFIRMED',
        'PAID_IN_FULL',
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

    const committed = await confirmOrderPayment(orderId, {
      paymentId,
      paymentType,
      verifiedAmountPYG: body?.verifiedAmountPYG,
      approvePartialPayment: body?.approvePartialPayment === true,
      acknowledgeOverpayment: body?.acknowledgeOverpayment === true,
      internalNote: String(body?.internalNote || ''),
    });

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
    await dispatchSellerNotificationsSafely();

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
      Number(error?.status || 400)
    );
  }
}
