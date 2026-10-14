import { getAuthorizedOrder, jsonResponse } from './_shared/commerce.mjs';
import { changePickup, pickupFulfillments } from './_shared/pickup.mjs';
import { dispatchSellerNotificationsSafely } from './_shared/seller-notifications.mjs';

export default async function handler(request) {
  if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'Método no permitido.' }, 405);
  try {
    const params = request.method === 'GET' ? new URL(request.url).searchParams : await request.json();
    const orderId = String(params.get?.('id') ?? params.orderId ?? '').trim();
    const access = String(params.get?.('access') ?? params.access ?? '').trim();
    const order = await getAuthorizedOrder(orderId, access);
    if (!order) return jsonResponse({ error: 'No encontramos ese pedido o el enlace privado no es válido.' }, 404);
    if (request.method === 'POST') {
      const slotKey = String(params.slotKey || '');
      if (!slotKey) return jsonResponse({ error: 'Elegí un horario.' }, 400);
      const timingKey = String(params.timingKey || '').trim();
      if (!timingKey) return jsonResponse({ error: 'Falta el tipo de retiro.' }, 400);
      await changePickup({ orderId, timingKey, slotKey, actor: 'CUSTOMER' });
      await dispatchSellerNotificationsSafely();
    }
    return jsonResponse({ ok: true, fulfillments: await pickupFulfillments(order) });
  } catch (error) {
    if (!error.status) console.error('Customer pickup failed', { code: error.code || 'unknown' });
    return jsonResponse({ error: error.status ? error.message : 'No se pudo agendar el retiro.' }, error.status || 500);
  }
}
