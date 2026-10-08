import { orderAccessToken } from './order-access.mjs';

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
const money = value => `Gs. ${Number(value || 0).toLocaleString('es-PY')}`;

function slotParts(key) {
  if (!key) return { date: '', time: '' };
  const [day, period] = key.split('|');
  if (!day || !period) return { date: '', time: '' };
  return {
    date: new Intl.DateTimeFormat('es-PY', { timeZone: 'UTC',
      day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`)),
    time: period.replace('-', ' a '),
  };
}

function notificationOrigin() {
  return String(process.env.DEPLOY_PRIME_URL || process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888');
}

export function notificationLinks(orderId, cartSessionId, origin = notificationOrigin()) {
  const url = new URL(`/pedido/${encodeURIComponent(orderId)}`, origin);
  url.searchParams.set('access', orderAccessToken(cartSessionId, orderId));
  return { privateOrderLink: url.toString(), pickupSchedulerLink: `${url}#pickup-scheduler` };
}

function customerHeader(order) {
  return `Cliente: ${String(order.buyer?.name || '').trim()}\nWhatsApp: ${String(order.buyer?.phone || '').trim()}\nPedido: ${order.id}`;
}

function completeCustomerMessage(order, body) {
  return `${customerHeader(order)}\n\n${body}\n\n¡Gracias!\n\nLos LaBossiere`;
}

export function customerNotification({ order, type, details = {}, privateOrderLink, pickupSchedulerLink }) {
  const name = String(order.buyer?.name || '').trim();
  const hello = `Hola ${name}.`;
  const id = order.id;
  switch (type) {
    case 'ORDER_CREATED':
      return { subject: `Pedido ${id} recibido`, text: completeCustomerMessage(order,
        `${hello}\n\n¡Gracias por tu pedido! Tus artículos quedaron reservados hasta ${localDateTime(order.holdExpiresAt)}.\n\nPara conservar la reserva, realizá la transferencia y cargá el comprobante desde tu enlace privado antes de ese horario.\n\nSi la reserva vence antes de recibir el comprobante, los artículos podrán volver a estar disponibles para otros compradores.\n\n${privateOrderLink}`) };
    case 'RECEIPT_UPLOADED':
      return { subject: `Comprobante recibido · ${id}`, text: completeCustomerMessage(order,
        `${hello}\n\nRecibimos el comprobante de tu pedido ${id}.\n\nEn breve verificaremos que la transferencia haya ingresado correctamente. La carga del comprobante no confirma el pago automáticamente.\n\nPodés seguir el estado de tu pedido desde este enlace:\n\n${privateOrderLink}`) };
    case 'FINAL_RECEIPT_UPLOADED':
      return { subject: `Comprobante del saldo recibido · ${id}`, text: completeCustomerMessage(order,
        `${hello}\n\nRecibimos el comprobante de tu pedido ${id}.\n\nEn breve verificaremos que la transferencia haya ingresado correctamente. La carga del comprobante no confirma el pago automáticamente.\n\nPodés seguir el estado de tu pedido desde este enlace:\n\n${privateOrderLink}`) };
    case 'PAYMENT_CONFIRMED': {
      const amount = money(details.verifiedAmountPYG);
      const paid = money(order.paidAmountPYG);
      const remaining = money(order.remainingBalancePYG);
      const delayed = order.items?.some(item => item.saleMode === 'DELAYED');
      const financialState = details.paymentState || order.paymentState ||
        (Number(order.remainingBalancePYG) === 0 ? 'FULLY_PAID'
          : Number(order.depositShortfallPYG || 0) > 0 ? 'PARTIALLY_PAID' : 'DEPOSIT_SATISFIED');
      if (financialState === 'FULLY_PAID') {
        return { subject: `Pago total confirmado · ${id}`, text: completeCustomerMessage(order,
          `${hello}\n\nConfirmamos el pago total de tu pedido ${id}. El último importe verificado fue ${amount}.\n\nPagado confirmado: ${paid}\nSaldo pendiente: ${remaining}\n\nYa podés elegir el horario de retiro desde este enlace:\n\n${pickupSchedulerLink}`) };
      }
      if (financialState === 'PARTIALLY_PAID') {
        return { subject: `${delayed ? 'Pago parcial de seña' : 'Pago parcial'} confirmado · ${id}`,
          text: completeCustomerMessage(order,
            `${hello}\n\nConfirmamos un pago parcial de ${amount} para tu pedido ${id}.\n\nPagado confirmado: ${paid}\nSaldo pendiente: ${remaining}\n\nPodés seguir el estado de tu pedido desde este enlace:\n\n${privateOrderLink}`) };
      }
      const depositJustSatisfied = Number(details.previousConfirmedPaidPYG || 0) <
        Number(order.totals?.dueNowPYG || 0);
      return depositJustSatisfied
        ? { subject: `Seña confirmada · ${id}`, text: completeCustomerMessage(order,
          `${hello}\n\nConfirmamos un pago de ${amount}. La seña de tu pedido ${id} está completa.\n\nPagado confirmado: ${paid}\nSaldo pendiente: ${remaining}\n\nPodés realizar pagos adicionales antes de la fecha final. Podés seguir el estado desde este enlace:\n\n${privateOrderLink}`) }
        : { subject: `Pago adicional confirmado · ${id}`, text: completeCustomerMessage(order,
          `${hello}\n\nConfirmamos un pago adicional de ${amount} para tu pedido ${id}.\n\nPagado confirmado: ${paid}\nSaldo pendiente: ${remaining}\n\nPodés seguir el estado de tu pedido desde este enlace:\n\n${privateOrderLink}`) };
    }
    case 'PICKUP_SCHEDULED':
    case 'PICKUP_CHANGED': {
      if (!details.slot) return { subject: `Retiro cancelado · ${id}`, text: completeCustomerMessage(order,
        `${hello}\n\nSe canceló el horario de retiro de tu pedido ${id}.\n\nTu compra sigue confirmada. Elegí otro horario desde este enlace:\n\n${pickupSchedulerLink}`) };
      const { date, time } = slotParts(details.slot);
      return { subject: type === 'PICKUP_SCHEDULED' ? `Retiro agendado · ${id}` : `Retiro modificado · ${id}`,
        text: completeCustomerMessage(order,
          `${hello}\n\n¡Gracias! Tu horario de retiro quedó registrado.\n\nFecha:\n${date}\n\nHora:\n${time}\n\nEsta es la ubicación de nuestra casa:\n\nhttps://goo.gl/maps/TMeEA6Fnoe1tcCmYA?g_st=aw\n\nSi necesitás cambiar el horario elegido, podés hacerlo desde este enlace:\n\n${privateOrderLink}`) };
    }
    case 'ORDER_RESERVATION_EXPIRING':
      return { subject: `Tu reserva vence pronto · ${id}`, text: completeCustomerMessage(order,
        `${hello}\n\nLa reserva de tu pedido vence en aproximadamente 30 minutos.\n\nPara conservar los artículos, realizá la transferencia y cargá el comprobante desde tu enlace privado antes del horario indicado:\n\n${privateOrderLink}`) };
    case 'ORDER_RESERVATION_EXPIRED':
      return { subject: `Reserva vencida · ${id}`, text: completeCustomerMessage(order,
        `${hello}\n\nLa reserva de tu pedido ${id} venció.\n\nNo realices ninguna transferencia todavía. Confirmá que los artículos sigan disponibles antes de pagar o cargar un comprobante:\n\n${privateOrderLink}`) };
    default:
      throw new Error(`Unsupported notification type: ${type}`);
  }
}

export async function queueOrderNotifications(client, { key, order, type, details = {} }) {
  const attempt = (await client.query('SELECT session_id FROM checkout_attempts WHERE order_id=$1', [order.id])).rows[0];
  if (!attempt?.session_id) throw new Error(`Missing checkout session for notification: ${order.id}`);
  const links = notificationLinks(order.id, attempt.session_id);
  const { subject, text } = customerNotification({ order, type, details, ...links });
  const customerEmail = String(order.buyer?.email || '').trim();
  const entries = [
    { role: 'SELLER', email: null, message: text },
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
