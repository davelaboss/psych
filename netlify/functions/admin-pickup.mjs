import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import { changePickup, listUpcomingPickups, pickupFulfillments } from './_shared/pickup.mjs';
import { getOrder } from './_shared/commerce.mjs';
import { dispatchSellerNotificationsSafely } from './_shared/seller-notifications.mjs';

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'Método no permitido.' }, 405);
  try {
    const params = request.method === 'GET' ? new URL(request.url).searchParams : await request.json();
    const orderId = String(params.get?.('id') ?? params.orderId ?? '').trim();
    if (!orderId && request.method === 'GET') return jsonResponse({ ok: true, upcoming: await listUpcomingPickups() });
    const order = await getOrder(orderId);
    if (!order) return jsonResponse({ error: 'Pedido no encontrado.' }, 404);
    if (request.method === 'POST') {
      const timingKey = String(params.timingKey || '').trim();
      if (!timingKey) return jsonResponse({ error: 'Falta el tipo de retiro.' }, 400);
      await changePickup({ orderId, timingKey, slotKey: params.slotKey || null, actor: 'ADMIN' });
      await dispatchSellerNotificationsSafely();
    }
    return jsonResponse({ ok: true, fulfillments: await pickupFulfillments(order) });
  } catch (error) {
    if (!error.status) console.error('Admin pickup failed', { code: error.code || 'unknown' });
    return jsonResponse({ error: error.status ? error.message : 'No se pudo actualizar el retiro.' }, error.status || 500);
  }
}
