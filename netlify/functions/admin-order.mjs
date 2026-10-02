import {
  adminAuthorized,
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

  if (request.method !== 'GET') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  const url =
    new URL(request.url);

  const orderId =
    String(
      url.searchParams.get('id') || ''
    ).trim();

  if (!orderId) {
    return jsonResponse(
      { error: 'Falta el pedido.' },
      400
    );
  }

  const order =
    await getOrder(orderId);

  if (!order) {
    return jsonResponse(
      { error: 'Pedido no encontrado.' },
      404
    );
  }

  const safeOrder = {
    ...order,
  };

  delete safeOrder.accessTokenHash;
  delete safeOrder.receipt;

  safeOrder.payments = (safeOrder.payments || []).map(payment => ({
    ...payment,
    receipt: payment.receipt ? {
      fileName: payment.receipt.fileName,
      contentType: payment.receipt.contentType,
      uploadedAt: payment.receipt.uploadedAt,
      uploadedBy: payment.receipt.uploadedBy,
      available: true,
    } : null,
  }));

  return jsonResponse({
    ok: true,
    order: safeOrder,
  });
}
