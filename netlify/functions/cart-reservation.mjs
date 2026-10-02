import { createHash } from 'node:crypto';
import {
  claimCartLease,
  cartSessionIdFromRequest,
  extendCartLease,
  getCartLeaseStatus,
  jsonResponse,
  loadCatalog,
  releaseCartLease,
  salesAreOpen,
  updateCartLease,
} from './_shared/commerce.mjs';


function setSessionCookie(response, sessionId, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  response.headers.append('set-cookie', `psych_cart_session=${sessionId}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure}`);
  return response;
}


export default async function handler(request) {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const cartSessionId = cartSessionIdFromRequest(request) || crypto.randomUUID();
      const { pendingOrderId, ...status } = await getCartLeaseStatus(cartSessionId);
      const checkoutRecovery = pendingOrderId ? {
        orderId: pendingOrderId,
        accessToken: createHash('sha256').update(`psych-cart-order-access:${cartSessionId}:${pendingOrderId}`).digest('hex'),
      } : null;
      return setSessionCookie(jsonResponse({ ok: true, ...status, checkoutRecovery }), cartSessionId, request);
    }
    if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);

    const body = await request.json();
    const cartSessionId = cartSessionIdFromRequest(request);
    if (!cartSessionId) return jsonResponse({ error: 'La sesión del carrito venció. Actualizá la página e intentá nuevamente.' }, 409);

    const action = String(body?.action || '');
    if (action === 'release-all') {
      const result = await releaseCartLease(cartSessionId);
      return jsonResponse({ ok: true, ...result });
    }
    if (action === 'extend') {
      const result = await extendCartLease(cartSessionId);
      return jsonResponse({ ok: true, ...result });
    }

    const productId = String(body?.productId || '');
    if (action !== 'release' && !productId) return jsonResponse({ error: 'Artículo inválido.' }, 400);
    if (action === 'claim' && !salesAreOpen(request)) {
      return jsonResponse({ error: 'Las ventas todavía no están abiertas.' }, 403);
    }
    if (!['claim', 'quantity', 'release'].includes(action)) {
      return jsonResponse({ error: 'Acción no válida.' }, 400);
    }

    let availability = 0;
    if (action !== 'release') {
      const catalog = await loadCatalog(url.origin);
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
      ? { lease: await claimCartLease({ cartSessionId, productId, quantity, availability }) }
      : await updateCartLease({ cartSessionId, productId, quantity, availability });
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'No se pudo actualizar la reserva.' }, Number(error?.status || 400));
  }
}
