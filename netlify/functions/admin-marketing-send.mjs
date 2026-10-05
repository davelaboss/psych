import { adminAuthorized, jsonResponse } from './_shared/commerce.mjs';
import { sendMarketingPacket } from './_shared/marketing-email-service.mjs';

export default async function handler(request) {
  if (!adminAuthorized(request)) return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);

  try {
    const body = await request.json();
    const packetId = String(body?.packetId || '').trim();
    if (!packetId) throw new Error('Falta la vista previa que se debe enviar.');
    const result = await sendMarketingPacket({
      packetId,
      requestOrigin: new URL(request.url).origin,
    });
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    console.error('Marketing email send failed', {
      status: error?.status || 500,
      providerStatus: error?.providerStatus || null,
      code: error?.code || 'unknown',
    });
    return jsonResponse({
      error: error instanceof Error ? error.message : 'No se pudo enviar el correo.',
    }, Number(error?.status || 500));
  }
}
