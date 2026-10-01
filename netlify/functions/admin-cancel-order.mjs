import { adminAuthorized, cancelOrder, getOrder, jsonResponse } from './_shared/commerce.mjs';

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);
  try {
    const body = await request.json();
    const orderId = String(body?.orderId || '').trim();
    if (!orderId) return jsonResponse({ error: 'Indicá el pedido.' }, 400);
    await cancelOrder(orderId);
    // A projection failure cannot undo the durable cancellation; reads/retries repair it.
    const order = { ...await getOrder(orderId) };
    delete order.accessTokenHash;
    return jsonResponse({ ok: true, order });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'No se pudo cancelar el pedido.' }, Number(error?.status || 400));
  }
}
