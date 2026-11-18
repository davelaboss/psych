import { jsonResponse } from './_shared/commerce.mjs';
import { liquidationEnabled } from './_shared/liquidation.mjs';

export default function handler(request) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Método no permitido.' }, 405);
  return jsonResponse({ liquidationActive: liquidationEnabled() });
}
