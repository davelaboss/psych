import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import { correctMarketplaceOrder, previewMarketplaceCorrection, ORDER_ID } from './_shared/marketplace-order-correction.mjs';
import { recoverOrderBlob } from './_shared/order-recovery.mjs';

export function createMarketplaceCorrectionHandler({ authorized = adminAuthorized,
  preview = previewMarketplaceCorrection, correct = correctMarketplaceOrder, recover = recoverOrderBlob } = {}) {
 return async function handler(request) {
  if (!await authorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'Método no permitido.' }, 405);
  try {
    if (request.method === 'GET') return jsonResponse({ ok: true, plan: await preview() });
    const result = await correct(await request.json());
    // A failed projection is recoverable: retry this same request, never reverse the durable transaction.
    try { await recover(ORDER_ID); }
    catch { return jsonResponse({ error: 'Corrección guardada. Reintentá la misma solicitud para sincronizar la proyección.', committed: true }, 503); }
    return jsonResponse({ ok: true, idempotent: result.idempotent, orderId: ORDER_ID,
      totalPYG: result.order.totals.totalPYG, paidAmountPYG: result.order.paidAmountPYG,
      remainingBalancePYG: result.order.remainingBalancePYG, status: result.order.status });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'No se pudo corregir el pedido.' }, Number(error?.status || 400));
  }
 };
}

export default createMarketplaceCorrectionHandler();
