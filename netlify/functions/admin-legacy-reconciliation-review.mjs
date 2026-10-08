import {
  adminAuthorized,
  getOrder,
  jsonResponse,
  listOrders,
  receiptStore,
} from './_shared/commerce.mjs';
import { reconcileAllowlistedLegacyPayment } from './_shared/inventory-database.mjs';
import {
  LEGACY_RECONCILIATION_REVIEW_ALLOWLIST,
  LEGACY_REVIEW_STATE_CHANGED,
  legacyReviewContextEntries,
  legacyReviewEntry,
  legacyReviewEvidenceLabel,
  legacyReviewRequiresReceiptValidation,
  legacyReviewSection,
  orderedLegacyReviewEntries,
  paymentIsCompletedForReview,
  proposedLegacyReviewNote,
  validateAllowlistedLegacyContext,
  validateLegacyReviewReceipt,
} from './_shared/legacy-reconciliation-review.mjs';

const allowedPostFields = new Set(['orderId', 'paymentId', 'ownerConfirmed']);

function rawSource(payment) {
  return payment?.amountSource == null ? 'ABSENT' : payment.amountSource;
}

function paymentFor(order, entry) {
  return order?.payments?.find(payment => payment.id === entry.paymentId) || null;
}

function reviewQueue(orders) {
  const ordersById = new Map(orders.map(order => [order.id, order]));
  const queue = [];
  for (const entry of orderedLegacyReviewEntries()) {
    const payment = paymentFor(ordersById.get(entry.orderId), entry);
    if (paymentIsCompletedForReview(payment, entry)) continue;
    let state = 'READY';
    try {
      validateAllowlistedLegacyContext(ordersById, entry);
    } catch {
      state = 'STATE_CHANGED';
    }
    queue.push({
      orderId: entry.orderId,
      customer: entry.customer,
      paymentId: entry.paymentId,
      amountPYG: entry.amountPYG,
      currentSource: rawSource(payment),
      basis: 'ACTUAL_VERIFIED',
      proposedNote: proposedLegacyReviewNote(entry),
      evidenceLabel: legacyReviewEvidenceLabel(entry),
      receiptAvailable: Boolean(payment?.receipt),
      section: legacyReviewSection(entry),
      state,
      stateMessage: state === 'STATE_CHANGED' ? LEGACY_REVIEW_STATE_CHANGED : null,
    });
  }
  return queue;
}

async function currentContext(entry) {
  const orders = await Promise.all(
    [...new Set(legacyReviewContextEntries(entry).map(candidate => candidate.orderId))]
      .map(orderId => getOrder(orderId))
  );
  return new Map(orders.filter(Boolean).map(order => [order.id, order]));
}

async function validateReceiptEvidence(entry) {
  try {
    const encoded = await receiptStore().get(entry.storageKey, {
      type: 'text',
      consistency: 'strong',
    });
    validateLegacyReviewReceipt(entry, encoded);
  } catch {
    throw Object.assign(new Error(LEGACY_REVIEW_STATE_CHANGED), { status: 409 });
  }
}

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);

  try {
    if (request.method === 'GET') {
      const queue = reviewQueue(await listOrders());
      return jsonResponse({
        ok: true,
        queue,
        remaining: queue.length,
        approvedCount: LEGACY_RECONCILIATION_REVIEW_ALLOWLIST.length,
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Método no permitido.' }, 405);
    }

    const body = await request.json();
    if (Object.keys(body || {}).some(key => !allowedPostFields.has(key))) {
      return jsonResponse({ error: 'La solicitud contiene campos no permitidos.' }, 400);
    }
    if (body?.ownerConfirmed !== true) {
      return jsonResponse({ error: 'La confirmación individual es obligatoria.' }, 400);
    }

    const orderId = String(body?.orderId || '').trim();
    const paymentId = String(body?.paymentId || '').trim();
    const entry = legacyReviewEntry(orderId, paymentId);
    if (!entry) return jsonResponse({ error: 'Este pago no pertenece a la lista revisada.' }, 404);

    const ordersById = await currentContext(entry);
    validateAllowlistedLegacyContext(ordersById, entry);

    await Promise.all(legacyReviewContextEntries(entry)
      .filter(legacyReviewRequiresReceiptValidation)
      .map(validateReceiptEvidence));
    const updated = await reconcileAllowlistedLegacyPayment(entry);
    if (!updated) throw Object.assign(new Error(LEGACY_REVIEW_STATE_CHANGED), { status: 409 });

    // Refresh the existing Blob projection after the authoritative transaction.
    await getOrder(entry.orderId);
    return jsonResponse({
      ok: true,
      orderId: entry.orderId,
      paymentId: entry.paymentId,
      amountPYG: entry.amountPYG,
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : LEGACY_REVIEW_STATE_CHANGED,
    }, Number(error?.status || 400));
  }
}
