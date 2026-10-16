import {
  customerCancelOrder,
  getAuthorizedOrder,
  jsonResponse,
  publicOrder,
} from './_shared/commerce.mjs';

export function createCustomerCancelOrderHandler({
  authorizeOrder = getAuthorizedOrder,
  cancelAuthorizedOrder = customerCancelOrder,
} = {}) {
  return async function handler(request) {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Método no permitido.' }, 405);
    }

    try {
      const body = await request.json();
      const orderId = String(body?.orderId || '').trim();
      const access = String(body?.access || '').trim();
      if (!orderId || !access) {
        return jsonResponse({ error: 'Acceso incompleto.' }, 400);
      }

      const authorizedOrder = await authorizeOrder(orderId, access);
      if (!authorizedOrder) {
        return jsonResponse({
          error: 'No encontramos ese pedido o el enlace privado no es válido.',
        }, 404);
      }

      const order = await cancelAuthorizedOrder(orderId);
      return jsonResponse({ ok: true, order: publicOrder(order) });
    } catch (error) {
      return jsonResponse({
        error: error instanceof Error
          ? error.message
          : 'No se pudo cancelar el pedido.',
      }, Number(error?.status || 400));
    }
  };
}

export default createCustomerCancelOrderHandler();
