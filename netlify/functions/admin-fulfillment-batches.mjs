import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import {
  listFulfillmentBatches,
  mutateFulfillmentBatch,
} from './_shared/fulfillment-batches.mjs';
import { explicitProductIds } from './_shared/fulfillment-batches-core.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createFulfillmentBatchesHandler({
  listBatches = listFulfillmentBatches,
  mutateBatch = mutateFulfillmentBatch,
} = {}) {
  return async function handler(request) {
    if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
    if (!['GET', 'POST'].includes(request.method)) {
      return jsonResponse({ error: 'Método no permitido.' }, 405);
    }

    try {
      if (request.method === 'GET') {
        return jsonResponse({ ok: true, fulfillmentBatches: await listBatches() });
      }

      const body = await request.json();
      const action = String(body?.action || '').trim().toUpperCase();
      const batchId = String(body?.batchId || '').trim();
      if (!batchId) return jsonResponse({ error: 'Falta el lote.' }, 400);
      if (!UUID.test(batchId)) return jsonResponse({ error: 'El lote no es válido.' }, 400);
      const targetBatchId = String(body?.targetBatchId || '').trim() || null;
      const orderId = String(body?.orderId || '').trim() || null;
      if (action === 'COMBINE' && !UUID.test(targetBatchId || '')) {
        return jsonResponse({ error: 'Seleccioná un lote de destino válido.' }, 400);
      }
      if (action === 'SEPARATE' && !orderId) {
        return jsonResponse({ error: 'Falta el pedido que se debe separar.' }, 400);
      }
      let productIds = null;
      if (action === 'SEPARATE') {
        productIds = explicitProductIds(body?.productIds);
      }

      const changedBatches = await mutateBatch({
        action,
        batchId,
        targetBatchId,
        orderId,
        productIds,
        expectedRevision: body?.expectedRevision,
        expectedTargetRevision: body?.expectedTargetRevision,
        confirmFrozen: body?.confirmFrozen === true,
      });
      return jsonResponse({
        ok: true,
        committed: true,
        changedBatches,
      });
    } catch (error) {
      return jsonResponse({
        error: error instanceof Error ? error.message : 'No se pudo actualizar el lote.',
        code: error?.code || null,
      }, Number(error?.status || 500));
    }
  };
}

export default createFulfillmentBatchesHandler();
