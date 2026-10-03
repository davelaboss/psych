async function database() {
  const module = await import('./inventory-database.mjs');
  return module.database();
}

export async function queueSellerNotification(client, { key, order, type, details = {} }) {
  const payload = {
    orderId: order.id,
    buyer: order.buyer?.name || '',
    itemNumbers: order.items?.map(item => item.itemNumber) || [],
    details,
  };
  await client.query(`INSERT INTO seller_notifications(event_key,order_id,event_type,payload)
    VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING`,
  [key, order.id, type, JSON.stringify(payload)]);
}

function emailContent(row) {
  const p = row.payload;
  const labels = {
    ORDER_CREATED: 'Nuevo pedido', RECEIPT_UPLOADED: 'Comprobante recibido',
    FINAL_RECEIPT_UPLOADED: 'Comprobante del saldo recibido',
    PICKUP_SCHEDULED: 'Retiro agendado', PICKUP_CHANGED: 'Retiro modificado',
  };
  const label = labels[row.event_type] || 'Actualización del pedido';
  const parts = [label, `Pedido: ${p.orderId}`, `Cliente: ${p.buyer}`,
    `Items: ${p.itemNumbers.map(n => String(n).padStart(3, '0')).join(', ')}`];
  if (p.details.slot) parts.push(`Retiro: ${p.details.slot}`);
  if (p.details.oldSlot) parts.push(`Retiro anterior: ${p.details.oldSlot}`);
  if (row.event_type === 'PICKUP_CHANGED' && !p.details.slot) parts.push('Retiro cancelado. La venta sigue activa.');
  return { subject: `${label} · ${p.orderId}`, text: parts.join('\n') };
}

async function claim() {
  const client = await (await database()).pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`SELECT * FROM seller_notifications
      WHERE status='PENDING' OR (((status='RETRYABLE' OR status='SENDING') AND lease_until<clock_timestamp())
        AND (created_at>clock_timestamp()-interval '24 hours'
          OR (status='RETRYABLE' AND last_error ~ '^provider_status_4[0-9][0-9]$' AND last_error<>'provider_status_409')))
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row) { await client.query('COMMIT'); return null; }
    await client.query(`UPDATE seller_notifications SET status='SENDING',attempts=attempts+1,
      lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() WHERE event_key=$1`, [row.event_key]);
    await client.query('COMMIT');
    return row;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function drainSellerNotifications(limit = 5) {
  if (!process.env.RESEND_API_KEY || !process.env.SELLER_NOTIFICATION_TO || !process.env.SELLER_NOTIFICATION_FROM) return;
  for (let i = 0; i < limit; i++) {
    const row = await claim();
    if (!row) return;
    try {
      const message = emailContent(row);
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json',
          'Idempotency-Key': row.event_key },
        body: JSON.stringify({ from: process.env.SELLER_NOTIFICATION_FROM,
          to: [process.env.SELLER_NOTIFICATION_TO], ...message }),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`provider_status_${response.status}`);
      const result = await response.json();
      await (await database()).pool.query(`UPDATE seller_notifications SET status='SENT',provider_id=$2,
        lease_until=NULL,last_error=NULL,updated_at=clock_timestamp() WHERE event_key=$1`, [row.event_key, result.id || null]);
    } catch (error) {
      const code = /^provider_status_\d+$/.test(error?.message || '') ? error.message : 'delivery_unknown';
      console.error('Seller notification delivery failed', { eventType: row.event_type, code });
      await (await database()).pool.query(`UPDATE seller_notifications SET status='RETRYABLE',
        lease_until=clock_timestamp()+interval '5 minutes',last_error=$2,updated_at=clock_timestamp() WHERE event_key=$1`, [row.event_key, code]);
    }
  }
}

export async function dispatchSellerNotificationsSafely() {
  try { await drainSellerNotifications(1); }
  catch (error) { console.error('Seller notification dispatch failed', { code: error?.code || 'unknown' }); }
}
