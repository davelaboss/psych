import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import { readPickupCalendar, changePickupBlackout } from './_shared/pickup-calendar.mjs';

// The existing seller credential is the sole OWNER account; never trust a client-supplied role.
export function createPickupCalendarHandler({ read = readPickupCalendar, change = changePickupBlackout } = {}) {
  return async request => {
    if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
    if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'Método no permitido.' }, 405);
    try {
      const result = request.method === 'GET'
        ? await read(new URL(request.url).searchParams.get('month') || '')
        : await change(await request.json());
      return jsonResponse({ ok: true, ...result });
    } catch (error) {
      return jsonResponse({ error: error.status ? error.message : 'No se pudo actualizar el calendario.' }, error.status || 500);
    }
  };
}
export default createPickupCalendarHandler();
