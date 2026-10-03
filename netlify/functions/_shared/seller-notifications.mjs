async function database() {
  const module = await import('./inventory-database.mjs');
  return module.database();
}

const resendKey = () => String(process.env.RESEND_API_KEY || '').trim()
  .replace(/^RESEND_API_KEY\s*=\s*/i, '');
const configuredSellerEmail = () => String(process.env.SELLER_NOTIFICATION_TO || '').trim()
  .replace(/^SELLER_NOTIFICATION_TO\s*=\s*/i, '');

const localDateTime = value => new Intl.DateTimeFormat('es-PY', {
  timeZone: 'America/Asuncion', dateStyle: 'long', timeStyle: 'short',
}).format(new Date(value));

function slotLabel(key) {
  if (!key) return '';
  const [day, period] = key.split('|');
  if (!day || !period) return '';
  const date = new Intl.DateTimeFormat('es-PY', { timeZone: 'UTC',
    day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
  const [start, end] = period.split('-');
  return `${date}, de ${start} a ${end}`;
}

export function customerNotification({ order, type, details = {} }) {
  const name = String(order.buyer?.name || '').trim();
  const hello = `Hola ${name}.`;
  const id = order.id;
  switch (type) {
    case 'ORDER_CREATED':
      return { subject: `Pedido ${id} recibido`, text: `${hello} Recibimos tu pedido ${id}. Tu reserva vence el ${localDateTime(order.holdExpiresAt)}. Para conservar los artículos, realizá la transferencia y cargá el comprobante desde tu enlace privado antes de ese horario. Gracias.` };
    case 'RECEIPT_UPLOADED':
      return { subject: `Comprobante recibido · ${id}`, text: `${hello} Recibimos el comprobante de tu pedido ${id}. El vendedor verificará que los fondos hayan ingresado. La carga del comprobante todavía no confirma el pago. Te avisaremos cuando esté confirmado.` };
    case 'FINAL_RECEIPT_UPLOADED':
      return { subject: `Comprobante del saldo recibido · ${id}`, text: `${hello} Recibimos el comprobante del saldo de tu pedido ${id}. El vendedor verificará que los fondos hayan ingresado. Podrás agendar el retiro después de que se confirme el pago total.` };
    case 'PAYMENT_CONFIRMED':
      return Number(order.remainingBalancePYG) > 0
        ? { subject: `Seña confirmada · ${id}`, text: `${hello} El vendedor confirmó la seña de tu pedido ${id}. El saldo se paga del 1 al 8 de diciembre de 2026. Podrás agendar el retiro después de que se confirme el pago total.` }
        : { subject: `Pago confirmado · ${id}`, text: `${hello} El vendedor confirmó el pago total de tu pedido ${id}. Ya podés elegir tu horario de retiro desde tu enlace privado del pedido. Gracias.` };
    case 'PICKUP_SCHEDULED':
      return { subject: `Retiro agendado · ${id}`, text: `${hello} El retiro de tu pedido ${id} quedó agendado para el ${slotLabel(details.slot)}. Si necesitás cambiarlo, abrí tu enlace privado del pedido.` };
    case 'PICKUP_CHANGED':
      return details.slot
        ? { subject: `Retiro modificado · ${id}`, text: `${hello} El horario de retiro de tu pedido ${id} cambió. Tu nuevo horario es el ${slotLabel(details.slot)}. Podés consultarlo en tu enlace privado del pedido.` }
        : { subject: `Retiro cancelado · ${id}`, text: `${hello} Se canceló el horario de retiro de tu pedido ${id}. Tu compra sigue confirmada. Podés elegir otro horario desde tu enlace privado del pedido.` };
    case 'ORDER_RESERVATION_EXPIRING':
      return { subject: `Tu reserva vence pronto · ${id}`, text: `${hello} Te avisamos que la reserva de tu pedido vence en aproximadamente 30 minutos. Si querés conservar los artículos, por favor realizá la transferencia y cargá el comprobante antes del horario indicado en tu pedido. Gracias.` };
    case 'ORDER_RESERVATION_EXPIRED':
      return { subject: `Reserva vencida · ${id}`, text: `${hello} La reserva de tu pedido ${id} venció. No realices ninguna transferencia todavía. Abrí tu enlace privado del pedido y confirmá que los artículos sigan disponibles antes de pagar o cargar un comprobante.` };
    default:
      throw new Error(`Unsupported notification type: ${type}`);
  }
}

export async function queueOrderNotifications(client, { key, order, type, details = {} }) {
  const { subject, text } = customerNotification({ order, type, details });
  const name = String(order.buyer?.name || '').trim();
  const phone = String(order.buyer?.phone || '').trim();
  const customerEmail = String(order.buyer?.email || '').trim();
  const sellerText = `Cliente: ${name}\nWhatsApp: ${phone}\nPedido: ${order.id}\n\n${text}`;
  const entries = [
    { role: 'SELLER', email: null, message: sellerText },
    ...(customerEmail ? [{ role: 'CUSTOMER', email: customerEmail, message: text }] : []),
  ];
  for (const entry of entries) {
    await client.query(`INSERT INTO seller_notifications
      (event_key,order_id,event_type,payload,recipient_role,recipient_email,subject,message)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_key) DO NOTHING`, [
      `${key}:${entry.role.toLowerCase()}`, order.id, type,
      JSON.stringify({ orderId: order.id }), entry.role, entry.email, subject, entry.message,
    ]);
  }
}

async function claim() {
  const client = await (await database()).pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`SELECT * FROM seller_notifications
      WHERE status='PENDING' OR (((status='RETRYABLE' OR status='SENDING') AND lease_until<clock_timestamp())
        AND (created_at>clock_timestamp()-interval '24 hours'
          OR (status='RETRYABLE' AND last_error ~ '^provider_status_4[0-9][0-9]$' AND last_error<>'provider_status_409')))
      ORDER BY created_at,event_key FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row) { await client.query('COMMIT'); return null; }
    const frozen = (await client.query(`UPDATE seller_notifications SET status='SENDING',attempts=attempts+1,
      lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp(),
      sender_email=COALESCE(sender_email,$2),
      recipient_email=CASE WHEN recipient_role='SELLER' AND recipient_email LIKE 'SELLER_NOTIFICATION_TO = %'
        THEN $3 ELSE COALESCE(recipient_email,$3) END
      WHERE event_key=$1 RETURNING *`, [row.event_key, process.env.SELLER_NOTIFICATION_FROM,
      row.recipient_role === 'SELLER' ? configuredSellerEmail() : row.recipient_email])).rows[0];
    await client.query('COMMIT');
    return frozen;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function drainSellerNotifications(limit = 5) {
  if (!resendKey() || !configuredSellerEmail() || !process.env.SELLER_NOTIFICATION_FROM) return;
  for (let i = 0; i < limit; i++) {
    const row = await claim();
    if (!row) return;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${resendKey()}`, 'content-type': 'application/json',
          'Idempotency-Key': row.event_key },
        body: JSON.stringify({ from: row.sender_email, to: [row.recipient_email],
          subject: row.subject, text: row.message }),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`provider_status_${response.status}`);
      const result = await response.json();
      await (await database()).pool.query(`UPDATE seller_notifications SET status='SENT',provider_id=$2,
        lease_until=NULL,last_error=NULL,updated_at=clock_timestamp() WHERE event_key=$1`, [row.event_key, result.id || null]);
    } catch (error) {
      const code = /^provider_status_\d+$/.test(error?.message || '') ? error.message : 'delivery_unknown';
      console.error('Order notification delivery failed', { eventType: row.event_type, role: row.recipient_role, code });
      await (await database()).pool.query(`UPDATE seller_notifications SET status='RETRYABLE',
        lease_until=clock_timestamp()+interval '5 minutes',last_error=$2,updated_at=clock_timestamp() WHERE event_key=$1`, [row.event_key, code]);
    }
  }
}

export async function dispatchSellerNotificationsSafely() {
  try { await drainSellerNotifications(2); }
  catch (error) { console.error('Order notification dispatch failed', { code: error?.code || 'unknown' }); }
}
