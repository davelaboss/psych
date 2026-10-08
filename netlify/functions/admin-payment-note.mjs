import { adminAuthorized, getOrder, jsonResponse } from './_shared/commerce.mjs';
import {
  recordOrderPostSalePriceAdjustment,
  reconcileOrderLegacyPayment,
  voidOrderLegacyDuplicatePayment,
} from './_shared/inventory-database.mjs';

function safeAdminOrder(order) {
  const safe = { ...order };
  delete safe.accessTokenHash;
  delete safe.receipt;
  safe.payments = (safe.payments || []).map(payment => ({
    ...payment,
    receipt: payment.receipt ? {
      fileName: payment.receipt.fileName,
      contentType: payment.receipt.contentType,
      uploadedAt: payment.receipt.uploadedAt,
      uploadedBy: payment.receipt.uploadedBy,
      available: true,
    } : null,
  }));
  return safe;
}

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);

  try {
    const body = await request.json();
    const orderId = String(body?.orderId || '').trim();
    const action = String(body?.action || '').trim().toUpperCase();
    if (!orderId) return jsonResponse({ error: 'Falta el pedido.' }, 400);
    if (![
      'RECONCILE_LEGACY_PAYMENT',
      'VOID_LEGACY_DUPLICATE_PAYMENT',
      'RECORD_POST_SALE_PRICE_ADJUSTMENT',
    ].includes(action)) {
      return jsonResponse({ error: 'Acción de pago inválida.' }, 400);
    }

    const paymentId = String(body?.paymentId || '').trim();
    const internalNote = String(body?.internalNote || '');
    let updated;
    if (action === 'RECONCILE_LEGACY_PAYMENT') {
      updated = await reconcileOrderLegacyPayment(orderId, {
        paymentId,
        reconciledAmountPYG: body?.reconciledAmountPYG,
        basis: String(body?.basis || '').trim(),
        internalNote,
      });
    } else if (action === 'VOID_LEGACY_DUPLICATE_PAYMENT') {
      updated = await voidOrderLegacyDuplicatePayment(orderId, { paymentId, internalNote });
    } else {
      updated = await recordOrderPostSalePriceAdjustment(orderId, {
        kind: String(body?.kind || '').trim(),
        amountPYG: body?.amountPYG,
        internalNote,
      });
    }
    if (!updated) return jsonResponse({ error: 'Pedido no encontrado.' }, 404);

    // getOrder refreshes the existing Blob projection after the transactional snapshot update.
    return jsonResponse({ ok: true, order: safeAdminOrder(await getOrder(orderId) || updated) });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'No se pudo actualizar el pago o ajuste.',
    }, Number(error?.status || 400));
  }
}
