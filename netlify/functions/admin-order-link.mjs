import { adminAuthorized, hashAccessToken, jsonResponse } from './_shared/commerce.mjs';
import { database } from './_shared/inventory-database.mjs';
import { orderAccessToken } from './_shared/order-access.mjs';

export function createAdminOrderLinkHandler({ query = (sql, params) => database().pool.query(sql, params) } = {}) {
  return async request => {
    if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
    if (request.method !== 'GET') return jsonResponse({ error: 'Método no permitido.' }, 405);
    const url = new URL(request.url);
    const orderId = String(url.searchParams.get('id') || '').trim();
    if (!orderId) return jsonResponse({ error: 'Falta el pedido.' }, 400);
    try {
      const row = (await query('SELECT session_id,order_snapshot FROM checkout_attempts WHERE order_id=$1', [orderId])).rows[0];
      if (!row) return jsonResponse({ error: 'Pedido no encontrado.' }, 404);
      const access = orderAccessToken(row.session_id, orderId);
      // Recover only the existing link; never rotate or replace customer access.
      if (hashAccessToken(access) !== row.order_snapshot?.accessTokenHash) {
        return jsonResponse({ error: 'No se pudo recuperar el enlace privado existente.' }, 409);
      }
      const link = new URL(`/pedido/${encodeURIComponent(orderId)}`, url.origin);
      link.searchParams.set('access', access);
      return jsonResponse({ ok: true, privateOrderLink: link.toString() });
    } catch {
      return jsonResponse({ error: 'No se pudo recuperar el enlace privado.' }, 500);
    }
  };
}

export default createAdminOrderLinkHandler();
