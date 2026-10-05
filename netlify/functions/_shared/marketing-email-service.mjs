import { randomUUID } from 'node:crypto';
import { loadCatalog } from './commerce.mjs';
import {
  buildImageAttachments,
  buildMarketingEmail,
  isMarketingEligible,
  packetForClient,
  selectMarketingProducts,
} from './marketing-email.mjs';

async function marketingDatabase() {
  const module = await import('./inventory-database.mjs');
  return module.database();
}

async function loadPurchasableCatalog(origin) {
  const inventoryModule = await import('./inventory-database.mjs');
  const [products, inventory] = await Promise.all([
    loadCatalog(origin),
    inventoryModule.readPurchasableInventory(),
  ]);
  return products.map((product) => {
    const row = inventory.get(product.id);
    if (!row) return { ...product, marketingInventoryVerified: false, purchasableQuantity: 0 };
    const purchasableQuantity = Math.max(0, Number(row.purchasable_quantity || 0));
    return {
      ...product,
      marketingInventoryVerified: true,
      purchasableQuantity,
      quantityRemaining: Math.min(Number(product.quantityRemaining || 0), purchasableQuantity),
    };
  });
}

function marketingOrigin(fallback) {
  return String(
    process.env.MARKETING_SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    fallback
  ).replace(/\/$/, '');
}

function packetFromRow(row) {
  if (!row) return null;
  const slotDate = typeof row.slot_date === 'string'
    ? row.slot_date.slice(0, 10)
    : new Date(row.slot_date).toISOString().slice(0, 10);
  return {
    id: row.id,
    slotDate,
    slotKey: row.slot_key,
    seed: row.selection_seed,
    products: row.selected_products,
    subject: row.subject,
    socialCopy: row.social_copy,
    html: row.html_body,
    text: row.text_body,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    providerId: row.provider_id || null,
  };
}

export async function recentMarketingHistory(days = 45) {
  const database = await marketingDatabase();
  const result = await database.pool.query(`
    SELECT feature.product_id AS "productId",
      feature.featured_at AS "featuredAt",
      packet.slot_date::text AS "slotDate",
      packet.slot_key AS "slotKey"
    FROM marketing_email_features feature
    JOIN marketing_email_packets packet ON packet.id=feature.packet_id
    WHERE feature.featured_at >= clock_timestamp()-($1::int * interval '1 day')
      AND packet.status='SENT'
    ORDER BY feature.featured_at DESC`, [days]);
  return result.rows.map((row) => ({
    ...row,
    featuredAt: new Date(row.featuredAt).toISOString(),
  }));
}

export async function createMarketingDraft({ requestOrigin, slotDate, slotKey }) {
  const origin = marketingOrigin(requestOrigin);
  const seed = randomUUID();
  const [products, history] = await Promise.all([
    loadPurchasableCatalog(origin),
    recentMarketingHistory(),
  ]);
  const selected = selectMarketingProducts({ products, history, slotDate, slotKey, seed });
  const rendered = buildMarketingEmail({ slotKey, products: selected, origin });
  const packet = {
    id: randomUUID(),
    slotDate,
    slotKey,
    seed,
    products: selected,
    subject: rendered.subject,
    socialCopy: rendered.socialCopy,
    html: rendered.html,
    text: rendered.text,
    status: 'DRAFT',
    idempotencyKey: '',
    sentAt: null,
  };
  packet.idempotencyKey = `marketing/${slotDate}/${slotKey}/${packet.id}`;

  const database = await marketingDatabase();
  await database.pool.query(`INSERT INTO marketing_email_packets
    (id,slot_date,slot_key,selection_seed,selected_products,subject,social_copy,
      html_body,text_body,status,idempotency_key)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'DRAFT',$10)`, [
    packet.id,
    packet.slotDate,
    packet.slotKey,
    packet.seed,
    JSON.stringify(packet.products),
    packet.subject,
    packet.socialCopy,
    packet.html,
    packet.text,
    packet.idempotencyKey,
  ]);

  return packetForClient(packet);
}

export async function getMarketingPacket(packetId) {
  const database = await marketingDatabase();
  const result = await database.pool.query(
    'SELECT * FROM marketing_email_packets WHERE id=$1',
    [packetId]
  );
  return packetFromRow(result.rows[0]);
}

async function revalidateSelection(packet, origin) {
  const liveProducts = await loadPurchasableCatalog(origin);
  const liveById = new Map(liveProducts.map((product) => [product.id, product]));
  const invalid = packet.products
    .map((product) => ({ snapshot: product, live: liveById.get(product.id) }))
    .filter(({ live }) => !isMarketingEligible(live));
  if (invalid.length) {
    const labels = invalid.map(({ snapshot }) =>
      `Item ${String(snapshot.itemNumber).padStart(3, '0')}`
    ).join(', ');
    throw Object.assign(
      new Error(`${labels} ya no está disponible para publicar. Regenerá la selección.`),
      { status: 409 }
    );
  }
}

async function claimPacket(packetId) {
  const database = await marketingDatabase();
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(
      'SELECT * FROM marketing_email_packets WHERE id=$1 FOR UPDATE',
      [packetId]
    )).rows[0];
    if (!row) throw Object.assign(new Error('No se encontró la vista previa.'), { status: 404 });
    if (row.status === 'SENT') {
      await client.query('COMMIT');
      return { packet: packetFromRow(row), alreadySent: true };
    }
    if (row.status === 'SENDING' && Date.now() - new Date(row.updated_at).getTime() < 5 * 60 * 1000) {
      throw Object.assign(new Error('Este correo ya se está enviando.'), { status: 409 });
    }

    await client.query(`INSERT INTO marketing_email_send_slots
      (slot_date,slot_key,packet_id,status)
      VALUES ($1,$2,$3,'SENDING')
      ON CONFLICT (slot_date,slot_key) DO NOTHING`,
      [row.slot_date, row.slot_key, row.id]);
    const guard = (await client.query(`SELECT * FROM marketing_email_send_slots
      WHERE slot_date=$1 AND slot_key=$2 FOR UPDATE`, [row.slot_date, row.slot_key])).rows[0];
    if (guard.packet_id !== row.id) {
      throw Object.assign(new Error('Ya existe otro envío para esta fecha y franja.'), { status: 409 });
    }

    const claimed = (await client.query(`UPDATE marketing_email_packets
      SET status='SENDING',last_error=NULL,updated_at=clock_timestamp()
      WHERE id=$1 RETURNING *`, [row.id])).rows[0];
    await client.query(`UPDATE marketing_email_send_slots
      SET status='SENDING',updated_at=clock_timestamp()
      WHERE slot_date=$1 AND slot_key=$2`, [row.slot_date, row.slot_key]);
    await client.query('COMMIT');
    return { packet: packetFromRow(claimed), alreadySent: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function marketingRecipient() {
  const value = String(process.env.MARKETING_EMAIL_TO || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('Configurá MARKETING_EMAIL_TO con un único correo destinatario.');
  }
  return value;
}

function marketingSender() {
  const value = String(
    process.env.MARKETING_EMAIL_FROM || process.env.SELLER_NOTIFICATION_FROM || ''
  ).trim();
  if (!value) throw new Error('Configurá MARKETING_EMAIL_FROM o SELLER_NOTIFICATION_FROM.');
  return value;
}

function resendKey() {
  const value = String(process.env.RESEND_API_KEY || '').trim()
    .replace(/^RESEND_API_KEY\s*=\s*/i, '');
  if (!value) throw new Error('Falta RESEND_API_KEY.');
  return value;
}

export async function deliverMarketingEmail({ packet, attachments, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${resendKey()}`,
      'content-type': 'application/json',
      'Idempotency-Key': packet.idempotencyKey,
    },
    body: JSON.stringify({
      from: marketingSender(),
      to: [marketingRecipient()],
      subject: packet.subject,
      html: packet.html,
      text: packet.text,
      attachments,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(`Resend rechazó el correo (${response.status}).`), {
      providerStatus: response.status,
      providerCode: result.name || result.message || null,
    });
  }
  return result;
}

async function markPacketSent(packet, providerId) {
  const database = await marketingDatabase();
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const sent = (await client.query(`UPDATE marketing_email_packets
      SET status='SENT',provider_id=$2,sent_at=COALESCE(sent_at,clock_timestamp()),
        last_error=NULL,updated_at=clock_timestamp()
      WHERE id=$1 RETURNING *`, [packet.id, providerId || null])).rows[0];
    for (const product of packet.products) {
      await client.query(`INSERT INTO marketing_email_features
        (packet_id,product_id,featured_at)
        VALUES ($1,$2,COALESCE($3,clock_timestamp()))
        ON CONFLICT (packet_id,product_id) DO NOTHING`,
      [packet.id, product.id, sent.sent_at]);
    }
    await client.query(`UPDATE marketing_email_send_slots
      SET status='SENT',updated_at=clock_timestamp()
      WHERE slot_date=$1 AND slot_key=$2 AND packet_id=$3`,
    [packet.slotDate, packet.slotKey, packet.id]);
    await client.query('COMMIT');
    return packetFromRow(sent);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function markPacketFailed(packet, error) {
  const database = await marketingDatabase();
  const message = String(error?.providerCode || error?.message || 'delivery_unknown').slice(0, 500);
  await database.pool.query(`UPDATE marketing_email_packets
    SET status='FAILED',last_error=$2,updated_at=clock_timestamp()
    WHERE id=$1 AND status<>'SENT'`, [packet.id, message]);
  await database.pool.query(`UPDATE marketing_email_send_slots
    SET status='FAILED',updated_at=clock_timestamp()
    WHERE slot_date=$1 AND slot_key=$2 AND packet_id=$3`,
  [packet.slotDate, packet.slotKey, packet.id]);
}

export async function sendMarketingPacket({ packetId, requestOrigin, fetchImpl = fetch }) {
  const existing = await getMarketingPacket(packetId);
  if (!existing) throw Object.assign(new Error('No se encontró la vista previa.'), { status: 404 });
  if (existing.status === 'SENT') return { packet: packetForClient(existing), alreadySent: true };

  const origin = marketingOrigin(requestOrigin);
  await revalidateSelection(existing, origin);
  const attachments = await buildImageAttachments(existing.products, origin, fetchImpl);
  await revalidateSelection(existing, origin);
  const { packet, alreadySent } = await claimPacket(packetId);
  if (alreadySent) return { packet: packetForClient(packet), alreadySent: true };

  try {
    const result = await deliverMarketingEmail({ packet, attachments, fetchImpl });
    const sent = await markPacketSent(packet, result.id);
    return { packet: packetForClient(sent), alreadySent: false };
  } catch (error) {
    await markPacketFailed(packet, error).catch((markError) => {
      console.error('Could not record marketing email failure', { code: markError?.code || 'unknown' });
    });
    throw error;
  }
}
