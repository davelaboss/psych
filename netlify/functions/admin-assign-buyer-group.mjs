import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import { assignBuyerGroup, listBuyerGroups } from './_shared/buyer-groups.mjs';

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);

  try {
    const body = await request.json();
    const orderId = String(body?.orderId || '').trim();
    const action = String(body?.action || '').trim().toUpperCase();
    const targetBuyerGroupId = String(body?.targetBuyerGroupId || '').trim() || null;
    if (!orderId) return jsonResponse({ error: 'Falta el pedido.' }, 400);
    if (action === 'MERGE' && !targetBuyerGroupId) {
      return jsonResponse({ error: 'Seleccioná un comprador existente.' }, 400);
    }

    const assignment = await assignBuyerGroup({ orderId, action, targetBuyerGroupId });
    if (!assignment) return jsonResponse({ error: 'Pedido no encontrado.' }, 404);
    return jsonResponse({ ok: true, assignment, buyerGroups: await listBuyerGroups() });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'No se pudo guardar el comprador.',
      code: error?.code || null,
    }, Number(error?.status || 500));
  }
}
