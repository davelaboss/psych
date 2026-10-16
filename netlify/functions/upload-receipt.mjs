import {
  getAuthorizedOrder,
  jsonResponse,
  publicOrder,
} from './_shared/commerce.mjs';
import { attachOrderReceipt } from './_shared/receipt-upload.mjs';


export default async function handler(request) {
  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  try {
    const form =
      await request.formData();

    const orderId =
      String(
        form.get('orderId') || ''
      ).trim();

    const accessToken =
      String(
        form.get('access') || ''
      ).trim();

    const file =
      form.get('file');

    const order =
      await getAuthorizedOrder(
        orderId,
        accessToken
      );

    if (!order) {
      return jsonResponse(
        {
          error:
            'No encontramos ese pedido o el enlace privado no es válido.',
        },
        404
      );
    }

    if (!['AWAITING_INITIAL_PAYMENT', 'RESERVATION_EXPIRED', 'DEPOSIT_CONFIRMED'].includes(order.status)) {
      return jsonResponse(
        {
          error:
            'Este pedido no admite otro comprobante en este momento.',
        },
        409
      );
    }

    const updatedOrder = await attachOrderReceipt({
      orderId,
      file,
      uploadedBy: 'CUSTOMER',
    });

    return jsonResponse({
      ok: true,

      order:
        publicOrder(updatedOrder),
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el comprobante.',
      },
      Number(error?.status || 400)
    );
  }
}
