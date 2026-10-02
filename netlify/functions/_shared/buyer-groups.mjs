import { randomUUID } from 'node:crypto';
import { database, inventoryTransaction } from './inventory-database.mjs';

const GROUP_LOCK = 20261003;

export function normalizeBuyerName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeBuyerPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

async function createGroup(client, buyer) {
  const buyerGroupId = randomUUID();
  await client.query(`INSERT INTO buyer_groups
    (buyer_group_id, display_name, display_phone)
    VALUES ($1, $2, $3)`, [
    buyerGroupId,
    String(buyer?.name || '').trim() || 'Comprador sin nombre',
    String(buyer?.phone || '').trim(),
  ]);
  return buyerGroupId;
}

async function ensureOrderGroup(client, row) {
  const existing = (await client.query(
    'SELECT * FROM buyer_group_orders WHERE order_id=$1',
    [row.order_id]
  )).rows[0];
  if (existing) return existing;

  const buyer = row.order_snapshot?.buyer || {};
  const normalizedName = normalizeBuyerName(buyer.name);
  const normalizedPhone = normalizeBuyerPhone(buyer.phone);
  let candidates = [];

  if (normalizedName && normalizedPhone) {
    candidates = (await client.query(`SELECT DISTINCT buyer_group_id
      FROM buyer_group_orders
      WHERE normalized_name=$1 AND normalized_phone=$2
        AND auto_match_blocked=false
      ORDER BY buyer_group_id`, [normalizedName, normalizedPhone])).rows;
  }

  const buyerGroupId = candidates.length === 1
    ? candidates[0].buyer_group_id
    : await createGroup(client, buyer);
  const assignmentMode = candidates.length === 1
    ? 'AUTO_MATCH'
    : candidates.length > 1
      ? 'AUTO_AMBIGUOUS'
      : 'AUTO_NEW';

  return (await client.query(`INSERT INTO buyer_group_orders
    (order_id, buyer_group_id, normalized_name, normalized_phone, assignment_mode)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`, [
    row.order_id,
    buyerGroupId,
    normalizedName,
    normalizedPhone,
    assignmentMode,
  ])).rows[0];
}

async function ensureAllBuyerGroups(client) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [GROUP_LOCK]);
  const rows = (await client.query(`SELECT order_id, order_snapshot
    FROM checkout_attempts
    ORDER BY created_at, order_id`)).rows;
  for (const row of rows) await ensureOrderGroup(client, row);
}

export async function listBuyerGroups() {
  await inventoryTransaction(ensureAllBuyerGroups);
  const rows = (await database().pool.query(`SELECT
      g.buyer_group_id,
      g.display_name,
      g.display_phone,
      g.created_at AS group_created_at,
      m.assignment_mode,
      m.auto_match_blocked,
      a.order_id,
      a.committed_at,
      a.order_snapshot,
      a.created_at AS order_created_at
    FROM buyer_groups g
    JOIN buyer_group_orders m USING (buyer_group_id)
    JOIN checkout_attempts a USING (order_id)
    ORDER BY lower(g.display_name), g.buyer_group_id, a.created_at, a.order_id`)).rows;

  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.buyer_group_id) || {
      buyerGroupId: row.buyer_group_id,
      displayName: row.display_name,
      displayPhone: row.display_phone,
      createdAt: row.group_created_at,
      orders: [],
      confirmedItems: [],
    };
    const order = row.order_snapshot;
    const confirmed = Boolean(row.committed_at) && order.status !== 'CANCELLED';
    group.orders.push({
      id: row.order_id,
      buyer: order.buyer,
      status: order.status,
      createdAt: row.order_created_at,
      committedAt: row.committed_at,
      assignmentMode: row.assignment_mode,
      autoMatchBlocked: row.auto_match_blocked,
    });
    if (confirmed) {
      for (const item of order.items || []) {
        group.confirmedItems.push({
          orderId: row.order_id,
          productId: item.productId,
          itemNumber: item.itemNumber,
          title: item.title,
          quantity: Number(item.quantity || 0),
          saleMode: item.saleMode,
        });
      }
    }
    groups.set(row.buyer_group_id, group);
  }

  return [...groups.values()];
}

export async function assignBuyerGroup({ orderId, action, targetBuyerGroupId }) {
  return inventoryTransaction(async client => {
    await ensureAllBuyerGroups(client);
    const order = (await client.query(`SELECT order_id, order_snapshot
      FROM checkout_attempts WHERE order_id=$1 FOR UPDATE`, [orderId])).rows[0];
    if (!order) return null;
    const current = (await client.query(`SELECT * FROM buyer_group_orders
      WHERE order_id=$1 FOR UPDATE`, [orderId])).rows[0];
    const previousGroupId = current.buyer_group_id;

    if (action === 'MERGE') {
      const target = (await client.query(`SELECT buyer_group_id FROM buyer_groups
        WHERE buyer_group_id=$1 FOR UPDATE`, [targetBuyerGroupId])).rows[0];
      if (!target) throw Object.assign(new Error('El comprador seleccionado ya no existe.'), { status: 404 });
      await client.query(`UPDATE buyer_group_orders
        SET buyer_group_id=$2, assignment_mode='MANUAL_MERGE',
            auto_match_blocked=false, updated_at=clock_timestamp()
        WHERE order_id=$1`, [orderId, targetBuyerGroupId]);
    } else if (action === 'SEPARATE') {
      if (current.assignment_mode !== 'MANUAL_SEPARATE' || !current.auto_match_blocked) {
        const buyerGroupId = await createGroup(client, order.order_snapshot?.buyer || {});
        await client.query(`UPDATE buyer_group_orders
          SET buyer_group_id=$2, assignment_mode='MANUAL_SEPARATE',
              auto_match_blocked=true, updated_at=clock_timestamp()
          WHERE order_id=$1`, [orderId, buyerGroupId]);
      }
    } else {
      throw Object.assign(new Error('Acción de comprador no válida.'), { status: 400 });
    }

    await client.query(`DELETE FROM buyer_groups g
      WHERE g.buyer_group_id=$1
        AND NOT EXISTS (
          SELECT 1 FROM buyer_group_orders m
          WHERE m.buyer_group_id=g.buyer_group_id
        )`, [previousGroupId]);

    return (await client.query(`SELECT m.*, g.display_name, g.display_phone
      FROM buyer_group_orders m
      JOIN buyer_groups g USING (buyer_group_id)
      WHERE m.order_id=$1`, [orderId])).rows[0];
  });
}
