import {
  claimCartLease,
  cartSessionIdFromRequest,
  getCartLeaseStatus,
  jsonResponse,
  loadCatalog,
  releaseCartLease,
  salesAreOpen,
  updateCartLease,
} from './_shared/commerce.mjs';
import { orderAccessToken } from './_shared/order-access.mjs';
import { recordAnalyticsEvent } from './_shared/sale-pulse.mjs';

const SALE_PULSE_SOURCES = new Set(['story', 'jw-group', 'direct']);


function currentUiAnalyticsContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const campaignSource = String(value.campaignSource || '').trim().toLowerCase();
  if (!SALE_PULSE_SOURCES.has(campaignSource)) return null;
  return { ...value, campaignSource };
}


function setSessionCookie(response, sessionId, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  response.headers.append('set-cookie', `psych_cart_session=${sessionId}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure}`);
  return response;
}


export function createCartReservationHandler({
  recordEvent = recordAnalyticsEvent,
  claimLease = claimCartLease,
  getLeaseStatus = getCartLeaseStatus,
  releaseLease = releaseCartLease,
  updateLease = updateCartLease,
  loadProducts = loadCatalog,
  salesOpen = salesAreOpen,
} = {}) {
  return async function handler(request, context) {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const cartSessionId = cartSessionIdFromRequest(request) || crypto.randomUUID();
      const { pendingOrderId, ...status } = await getLeaseStatus(cartSessionId);
      const checkoutRecovery = pendingOrderId ? {
        orderId: pendingOrderId,
        accessToken: orderAccessToken(cartSessionId, pendingOrderId),
      } : null;
      return setSessionCookie(jsonResponse({ ok: true, ...status, checkoutRecovery }), cartSessionId, request);
    }
    if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);

    const body = await request.json();
    const cartSessionId = cartSessionIdFromRequest(request);
    if (!cartSessionId) return jsonResponse({ error: 'La sesión del carrito venció. Actualizá la página e intentá nuevamente.' }, 409);

    const action = String(body?.action || '');
    if (action === 'release-all') {
      const result = await releaseLease(cartSessionId);
      return jsonResponse({ ok: true, ...result });
    }
    if (action === 'extend') {
      return jsonResponse({ error: 'La reserva del carrito no admite extensiones.' }, 400);
    }

    const productId = String(body?.productId || '');
    if (action !== 'release' && !productId) return jsonResponse({ error: 'Artículo inválido.' }, 400);
    if (action === 'claim' && !salesOpen(request)) {
      return jsonResponse({ error: 'Las ventas todavía no están abiertas.' }, 403);
    }
    if (!['claim', 'quantity', 'release'].includes(action)) {
      return jsonResponse({ error: 'Acción no válida.' }, 400);
    }

    let availability = 0;
    if (action !== 'release') {
      const catalog = await loadProducts(url.origin);
      const product = catalog.find((item) => item.id === productId);
      if (action === 'claim' && (!product || product.status !== 'AVAILABLE')) {
        return jsonResponse({ error: 'Este artículo ya no está disponible.' }, 409);
      }
      availability = product?.status === 'AVAILABLE'
        ? Number(product.quantityRemaining ?? product.quantityTotal ?? 1)
        : 0;
    }

    const quantity = action === 'release'
      ? 0
      : Math.max(1, Math.min(999, Math.floor(Number(body?.quantity) || 1)));
    const result = action === 'claim'
      ? { lease: await claimLease({ cartSessionId, productId, quantity, availability }) }
      : await updateLease({ cartSessionId, productId, quantity, availability });

    const analytics = action === 'claim'
      ? currentUiAnalyticsContext(body?.analytics)
      : null;
    if (analytics) {
      const tracking = Promise.resolve().then(() => recordEvent({
        sessionId: cartSessionId,
        event: {
          eventType: 'ADD_TO_CART',
          productId,
          campaignSource: analytics.campaignSource,
          category: analytics.category,
          searchTerm: analytics.searchTerm,
          filters: analytics.filters,
          resultPosition: analytics.resultPosition,
          resultCount: analytics.resultCount,
        },
      })).catch(() => {});
      if (typeof context?.waitUntil === 'function') context.waitUntil(tracking);
      else void tracking;
    }

    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'No se pudo actualizar la reserva.' }, Number(error?.status || 400));
  }
  };
}

export default createCartReservationHandler();
