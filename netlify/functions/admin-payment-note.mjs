import { adminAuthorized, getOrder, jsonResponse } from './_shared/commerce.mjs';
import {
  addOrderPaymentNote,
  reconcileOrderLegacyPayment,
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
    const action = String(body?.action || 'ADD_NOTE').trim().toUpperCase();
    if (!orderId) return jsonResponse({ error: 'Falta el pedido.' }, 400);
    if (!['ADD_NOTE', 'RECONCILE_LEGACY_PAYMENT'].includes(action)) {
      return jsonResponse({ error: 'Acción de pago inválida.' }, 400);
    }
    if (!await getOrder(orderId)) return jsonResponse({ error: 'Pedido no encontrado.' }, 404);

    const updated = action === 'RECONCILE_LEGACY_PAYMENT'
      ? await reconcileOrderLegacyPayment(orderId, {
          paymentId: String(body?.paymentId || '').trim(),
          reconciledAmountPYG: body?.reconciledAmountPYG,
          basis: String(body?.basis || '').trim(),
          internalNote: String(body?.internalNote || ''),
        })
      : await addOrderPaymentNote(orderId, {
          kind: String(body?.kind || '').trim(),
          text: String(body?.text || ''),
          relatedPaymentId: String(body?.relatedPaymentId || '').trim() || null,
        });

    if (!updated) return jsonResponse({ error: 'Pedido no encontrado.' }, 404);
    return jsonResponse({ ok: true, order: safeAdminOrder(await getOrder(orderId)) });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'No se pudo guardar la información de pago.',
    }, Number(error?.status || 400));
  }
}
