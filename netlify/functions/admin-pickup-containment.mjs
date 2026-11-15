import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import { readPickupWriteControl, setPickupWriteControl } from './_shared/pickup-write-control.mjs';

export function createPickupContainmentHandler(dependencies = {}) {
  return async request => {
    if (!(dependencies.authorized || adminAuthorized)(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
    if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'Método no permitido.' }, 405);
    try {
      const result = request.method === 'POST'
        ? await (dependencies.set || setPickupWriteControl)(await request.json())
        : { state: await (dependencies.read || readPickupWriteControl)() };
      return jsonResponse({ ok: true, ...result });
    } catch (error) {
      return jsonResponse({ error: error.status ? error.message : 'No se confirmó el estado. Actualizá antes de continuar.' }, error.status || 503);
    }
  };
}
export default createPickupContainmentHandler();
