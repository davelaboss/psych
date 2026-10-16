import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import { listBuyerGroups } from './_shared/buyer-groups.mjs';

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (request.method !== 'GET') return jsonResponse({ error: 'Método no permitido.' }, 405);

  try {
    return jsonResponse({ ok: true, buyerGroups: await listBuyerGroups() });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'No se pudieron cargar los compradores.',
    }, Number(error?.status || 500));
  }
}
