import { adminAuthorized, jsonResponse, loadCatalog } from './_shared/commerce.mjs';
import { withdrawFromSale } from './_shared/owner-withdrawal.mjs';

export function createWithdrawalHandler({ authorized = adminAuthorized, loadProducts = loadCatalog, withdraw = withdrawFromSale } = {}) {
  return async request => {
    if (!await authorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
    if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);
    try {
      const body = await request.json();
      const products = await loadProducts(new URL(request.url).origin);
      const product = products.find(p => p.id === body.productId);
      const withdrawal = await withdraw(product, { confirmed: body.confirmed === true, actor: 'OWNER' });
      return jsonResponse({ ok: true, withdrawal, message: 'Artículo retirado de la venta. No se registró una venta ni una entrega. Su ficha, fotos e historial se conservan.' });
    } catch (error) {
      return jsonResponse({ error: error.message, commitments: error.commitments || [] }, Number(error.status || 400));
    }
  };
}
export default createWithdrawalHandler();
