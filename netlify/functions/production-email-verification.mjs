import { createHash, timingSafeEqual } from 'node:crypto';

const expected = '8846c24c0013620437b40dcf1632a5e8d1d07972ce38041ad10f9350449453f0';
const clean = (name, value) => String(value || '').trim().replace(new RegExp(`^${name}\\s*=\\s*`, 'i'), '');

export default async function handler(request) {
  const supplied = createHash('sha256').update(request.headers.get('x-verification-token') || '').digest('hex');
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return new Response('Not found', { status: 404 });
  const key = clean('RESEND_API_KEY', process.env.RESEND_API_KEY);
  const from = clean('SELLER_NOTIFICATION_FROM', process.env.SELLER_NOTIFICATION_FROM);
  const to = clean('SELLER_NOTIFICATION_TO', process.env.SELLER_NOTIFICATION_TO);
  if (!key || !from || !to) return Response.json({ ok: false, reason: 'configuration' }, { status: 503 });
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json',
      'Idempotency-Key': 'psych-production-email-verification-bbc85d9' },
    body: JSON.stringify({ from, to: [to], subject: 'Verificación de email de producción',
      text: 'Este es el mensaje de verificación del sistema de notificaciones de producción de Psych. No corresponde a ningún pedido de cliente.' }),
    signal: AbortSignal.timeout(5000),
  });
  const sent = await response.json().catch(() => ({}));
  if (!response.ok || !sent.id) return Response.json({ ok: false, providerStatus: response.status }, { status: 502 });
  await new Promise(resolve => setTimeout(resolve, 2000));
  const lookup = await fetch(`https://api.resend.com/emails/${encodeURIComponent(sent.id)}`, {
    headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
  });
  const status = lookup.ok ? await lookup.json() : null;
  return Response.json({ ok: true, accepted: true, deliveryEvent: status?.last_event || null,
    lookupStatus: lookup.status });
}
