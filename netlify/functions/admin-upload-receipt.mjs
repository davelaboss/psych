import {
  adminAuthorized,
  getOrder,
  jsonResponse,
} from './_shared/commerce.mjs';
import { attachOrderReceipt } from './_shared/receipt-upload.mjs';

function safeAdminOrder(order) {
  const safe = { ...order };
  delete safe.accessTokenHash;
  delete safe.receipt;
  safe.payments = (safe.payments || []).map(payment => ({ ...payment,
    receipt: payment.receipt ? { fileName: payment.receipt.fileName, contentType: payment.receipt.contentType,
      uploadedAt: payment.receipt.uploadedAt, uploadedBy: payment.receipt.uploadedBy, available: true } : null }));
  return safe;
}

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);

  try {
    const form = await request.formData();
    const orderId = String(form.get('orderId') || '').trim();
    const file = form.get('file');
    if (!orderId) return jsonResponse({ error: 'Falta el pedido.' }, 400);

    const order = await getOrder(orderId);
    if (!order) return jsonResponse({ error: 'Pedido no encontrado.' }, 404);
    if (order.payments.some(payment => payment.verificationStatus === 'PENDING')) {
      return jsonResponse({ error: 'Este pedido ya tiene un comprobante pendiente de verificación.' }, 409);
    }
    if (!['AWAITING_INITIAL_PAYMENT', 'DEPOSIT_CONFIRMED'].includes(order.status) || order.remainingBalancePYG <= 0) {
      return jsonResponse({ error: 'Este pedido no admite la carga de un comprobante.' }, 409);
    }

    const updatedOrder = await attachOrderReceipt({ orderId, file, uploadedBy: 'ADMIN' });
    return jsonResponse({ ok: true, order: safeAdminOrder(updatedOrder) });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'No se pudo cargar el comprobante.',
    }, Number(error?.status || 400));
  }
}
