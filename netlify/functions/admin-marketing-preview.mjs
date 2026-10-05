import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import { createMarketingDraft } from './_shared/marketing-email-service.mjs';
import { MARKETING_SLOT_KEYS } from './_shared/marketing-email.mjs';

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);

  try {
    const body = await request.json();
    const slotDate = String(body?.slotDate || '').trim();
    const slotKey = String(body?.slotKey || '').trim().toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) throw new Error('Elegí una fecha válida.');
    if (!MARKETING_SLOT_KEYS.includes(slotKey)) throw new Error('Elegí una franja válida.');
    const weekday = new Date(`${slotDate}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) throw new Error('Los correos de marketing se preparan de lunes a viernes.');
    const expectedDay = ['', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', ''][weekday];
    if (!slotKey.startsWith(`${expectedDay}_`)) throw new Error('La franja debe coincidir con el día de la fecha elegida.');

    const packet = await createMarketingDraft({
      requestOrigin: new URL(request.url).origin,
      slotDate,
      slotKey,
    });
    return jsonResponse({ ok: true, packet });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'No se pudo generar la vista previa.',
    }, Number(error?.status || 400));
  }
}
