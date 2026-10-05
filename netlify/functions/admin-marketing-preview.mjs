import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import {
  getMarketingPacketForSlot,
  resolveMarketingDraft,
} from './_shared/marketing-email-service.mjs';
import { MARKETING_SLOT_KEYS, packetForClient } from './_shared/marketing-email.mjs';

function validateSlot(slotDate, slotKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) throw new Error('Elegí una fecha válida.');
  if (!MARKETING_SLOT_KEYS.includes(slotKey)) throw new Error('Elegí una franja válida.');
  const weekday = new Date(`${slotDate}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) throw new Error('Los correos de marketing se preparan de lunes a viernes.');
  const expectedDay = ['', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', ''][weekday];
  if (!slotKey.startsWith(`${expectedDay}_`)) throw new Error('La franja debe coincidir con el día de la fecha elegida.');
}

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'Método no permitido.' }, 405);

  try {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : null;
    const slotDate = String(body?.slotDate || url.searchParams.get('slotDate') || '').trim();
    const slotKey = String(body?.slotKey || url.searchParams.get('slotKey') || '').trim().toUpperCase();
    validateSlot(slotDate, slotKey);

    if (request.method === 'GET') {
      const packet = await getMarketingPacketForSlot(slotDate, slotKey);
      return jsonResponse({ ok: true, packet: packet ? packetForClient(packet) : null });
    }

    const packet = await resolveMarketingDraft({
      requestOrigin: new URL(request.url).origin,
      slotDate,
      slotKey,
      regenerate: body?.regenerate === true,
    });
    return jsonResponse({ ok: true, packet });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'No se pudo generar la vista previa.',
    }, Number(error?.status || 400));
  }
}
