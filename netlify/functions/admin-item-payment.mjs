import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import { appendItemPaymentDecision, readItemPaymentDecisions } from './_shared/item-payment-decisions.mjs';
export function createItemPaymentHandler(dependencies = {}) {
  return async request => {
    if (!(dependencies.authorized || adminAuthorized)(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
    if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'Método no permitido.' }, 405);
    try {
      const input = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json();
      const orderId = String(input.orderId || '').trim();
      if (!orderId) return jsonResponse({ error: 'Falta el pedido.' }, 400);
      const result = request.method === 'POST'
        ? await (dependencies.append || appendItemPaymentDecision)(orderId, input)
        : await (dependencies.read || readItemPaymentDecisions)(orderId);
      return jsonResponse({ ok: true, decisions: result });
    } catch (error) {
      return jsonResponse({ error: error.status ? error.message : 'No se pudo registrar la decisión.' }, error.status || 500);
    }
  };
}
export default createItemPaymentHandler();
