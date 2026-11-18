import {
  jsonResponse,
  loadPublicCatalog,
  cartSessionIdFromRequest,
} from './_shared/commerce.mjs';
import { liquidationEnabled } from './_shared/liquidation.mjs';


export default async function handler(request) {
  if (request.method !== 'GET') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  const origin =
    new URL(request.url).origin;
  const requestedSlug =
    new URL(request.url).searchParams.get('slug') || '';

  const {
    products,
    deliveredProduct,
  } = await loadPublicCatalog(origin, { requestedSlug, cartSessionId: cartSessionIdFromRequest(request) });

  return jsonResponse({
    ok: true,
    liquidationActive: liquidationEnabled(),
    products,
    deliveredProduct,
  });
}
