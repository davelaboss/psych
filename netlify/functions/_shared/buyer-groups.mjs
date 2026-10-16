import { randomUUID } from 'node:crypto';
import { database, inventoryTransaction } from './inventory-database.mjs';
import { FULFILLMENT_LOCK } from './fulfillment-batches-core.mjs';

const GROUP_LOCK = 20261003;
const fulfillmentStatusLabel = status => ({
  PREPARED: 'preparada',
  DELIVERED: 'entregada',
  LEGACY_FROZEN: 'histórica congelada',
})[status] || 'congelada';
const reassignmentConflict = batch => Object.assign(
  new Error(`No se puede cambiar el comprador porque la planilla ${batch.fulfillment_batch_id} está ${
    batch.merged_into_batch_id ? 'combinada con otra planilla' : fulfillmentStatusLabel(batch.status)
  }. Solo las planillas abiertas se pueden reagrupar.`),
  { status: 409, code: 'FULFILLMENT_BUYER_REASSIGNMENT_BLOCKED' }
);

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

export async function ensureAllBuyerGroups(client) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [GROUP_LOCK]);
  const rows = (await client.query(`SELECT order_id, order_snapshot
    FROM checkout_attempts
    ORDER BY created_at, order_id`)).rows;
  for (const row of rows) await ensureOrderGroup(client, row);
}

export async function listBuyerGroups(dependencies = {}) {
  const runTransaction = dependencies.transaction || inventoryTransaction;
  const query = dependencies.query || ((sql, params) => database().pool.query(sql, params));
  await runTransaction(ensureAllBuyerGroups);
  const rows = (await query(`SELECT
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
    const order = row.order_snapshot && typeof row.order_snapshot === 'object' &&
      !Array.isArray(row.order_snapshot) ? row.order_snapshot : {};
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
      for (const item of Array.isArray(order.items) ? order.items : []) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
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

export async function assertBuyerGroupReassignmentAllowed(client, {
  action,
  orderId,
  previousGroupId,
}) {
  if (!['MERGE', 'SEPARATE'].includes(action)) return [];
  const rows = action === 'MERGE'
    ? (await client.query(`SELECT batch.*
        FROM fulfillment_batches batch
        WHERE batch.buyer_group_id=$1
        ORDER BY batch.fulfillment_batch_id
        FOR UPDATE`, [previousGroupId])).rows
    : (await client.query(`SELECT batch.*
        FROM fulfillment_batches batch
        WHERE batch.fulfillment_batch_id IN (
          SELECT item.fulfillment_batch_id
          FROM fulfillment_batch_items item
          WHERE item.order_id=$1
        )
        ORDER BY batch.fulfillment_batch_id
        FOR UPDATE`, [orderId])).rows;
  const immutable = rows.find(batch => batch.status !== 'OPEN' || batch.merged_into_batch_id);
  if (immutable) throw reassignmentConflict(immutable);
  return rows;
}

async function fulfillmentItems(client, batchId, orderId = null) {
  return (await client.query(`SELECT order_id,product_id,fulfillment_batch_id
    FROM fulfillment_batch_items
    WHERE fulfillment_batch_id=$1
      AND ($2::text IS NULL OR order_id=$2)
    ORDER BY order_id,product_id
    FOR UPDATE`, [batchId, orderId])).rows;
}

async function recordBuyerGroupingEvent(client, {
  eventType,
  fulfillmentBatchId,
  sourceBatchId,
  targetBatchId,
  items,
  revisions,
  context,
}) {
  await client.query(`INSERT INTO fulfillment_batch_events
    (event_type,fulfillment_batch_id,source_batch_id,target_batch_id,actor,
      affected_items,revisions,context)
    VALUES($1,$2,$3,$4,'ADMIN',$5::jsonb,$6::jsonb,$7::jsonb)`, [
    eventType,
    fulfillmentBatchId,
    sourceBatchId,
    targetBatchId,
    JSON.stringify(items),
    JSON.stringify(revisions),
    JSON.stringify(context),
  ]);
}

export async function reconcileBuyerGroupMerge(client, {
  sourceGroupId,
  targetGroupId,
  sourceBatches,
}) {
  if (sourceGroupId === targetGroupId || sourceBatches.length === 0) return [];
  const targetBatches = (await client.query(`SELECT * FROM fulfillment_batches
    WHERE buyer_group_id=$1
    ORDER BY fulfillment_batch_id
    FOR UPDATE`, [targetGroupId])).rows;
  const destinationByTiming = new Map();
  for (const batch of targetBatches) {
    if (batch.status !== 'OPEN' || batch.auto_attach !== true || batch.merged_into_batch_id) continue;
    if (destinationByTiming.has(batch.timing_key)) {
      throw Object.assign(new Error('Hay más de una planilla abierta compatible para el comprador de destino.'), {
        status: 409,
        code: 'DUPLICATE_OPEN_BATCH',
      });
    }
    destinationByTiming.set(batch.timing_key, batch);
  }

  const changedBatchIds = new Set();
  for (const source of [...sourceBatches].sort((a, b) =>
    String(a.fulfillment_batch_id).localeCompare(String(b.fulfillment_batch_id)))) {
    const items = (await fulfillmentItems(client, source.fulfillment_batch_id)).map(row => ({
      orderId: row.order_id,
      productId: row.product_id,
    }));
    const compatible = source.auto_attach === true
      ? destinationByTiming.get(source.timing_key)
      : null;

    if (compatible) {
      await client.query(`UPDATE fulfillment_batch_items
        SET fulfillment_batch_id=$2,assignment_mode='MANUAL_COMBINE',updated_at=clock_timestamp()
        WHERE fulfillment_batch_id=$1`, [source.fulfillment_batch_id, compatible.fulfillment_batch_id]);
      const updatedSource = (await client.query(`UPDATE fulfillment_batches SET
          buyer_group_id=$2,auto_attach=false,merged_into_batch_id=$3,
          revision=revision+1,updated_at=clock_timestamp()
        WHERE fulfillment_batch_id=$1 RETURNING *`, [
        source.fulfillment_batch_id,
        targetGroupId,
        compatible.fulfillment_batch_id,
      ])).rows[0];
      const updatedTarget = (await client.query(`UPDATE fulfillment_batches SET
          revision=revision+1,updated_at=clock_timestamp()
        WHERE fulfillment_batch_id=$1 RETURNING *`, [compatible.fulfillment_batch_id])).rows[0];
      destinationByTiming.set(source.timing_key, updatedTarget);
      changedBatchIds.add(updatedSource.fulfillment_batch_id);
      changedBatchIds.add(updatedTarget.fulfillment_batch_id);
      await recordBuyerGroupingEvent(client, {
        eventType: 'COMBINE',
        fulfillmentBatchId: updatedTarget.fulfillment_batch_id,
        sourceBatchId: updatedSource.fulfillment_batch_id,
        targetBatchId: updatedTarget.fulfillment_batch_id,
        items,
        revisions: {
          sourceBefore: Number(source.revision),
          sourceAfter: Number(updatedSource.revision),
          targetBefore: Number(compatible.revision),
          targetAfter: Number(updatedTarget.revision),
        },
        context: { reason: 'BUYER_GROUP_MERGE', sourceGroupId, targetGroupId },
      });
      continue;
    }

    await client.query(`UPDATE fulfillment_batch_items
      SET assignment_mode='MANUAL_COMBINE',updated_at=clock_timestamp()
      WHERE fulfillment_batch_id=$1`, [source.fulfillment_batch_id]);
    const updated = (await client.query(`UPDATE fulfillment_batches SET
        buyer_group_id=$2,revision=revision+1,updated_at=clock_timestamp()
      WHERE fulfillment_batch_id=$1 RETURNING *`, [source.fulfillment_batch_id, targetGroupId])).rows[0];
    if (updated.auto_attach === true) destinationByTiming.set(updated.timing_key, updated);
    changedBatchIds.add(updated.fulfillment_batch_id);
    await recordBuyerGroupingEvent(client, {
      eventType: 'COMBINE',
      fulfillmentBatchId: updated.fulfillment_batch_id,
      sourceBatchId: updated.fulfillment_batch_id,
      targetBatchId: updated.fulfillment_batch_id,
      items,
      revisions: { before: Number(source.revision), after: Number(updated.revision) },
      context: { reason: 'BUYER_GROUP_REHOME', sourceGroupId, targetGroupId },
    });
  }
  return [...changedBatchIds];
}

export async function reconcileBuyerGroupSeparation(client, {
  orderId,
  sourceGroupId,
  targetGroupId,
  sourceBatches,
  createId = randomUUID,
}) {
  if (sourceBatches.length === 0) return [];
  const sourceById = new Map(sourceBatches.map(batch => [batch.fulfillment_batch_id, batch]));
  const memberships = (await client.query(`SELECT order_id,product_id,fulfillment_batch_id
    FROM fulfillment_batch_items
    WHERE order_id=$1 AND fulfillment_batch_id=ANY($2::uuid[])
    ORDER BY fulfillment_batch_id,product_id
    FOR UPDATE`, [orderId, [...sourceById.keys()]])).rows;
  const membershipsByTiming = new Map();
  for (const membership of memberships) {
    const source = sourceById.get(membership.fulfillment_batch_id);
    if (!source) continue;
    const group = membershipsByTiming.get(source.timing_key) || { sourceIds: new Set(), items: [] };
    group.sourceIds.add(source.fulfillment_batch_id);
    group.items.push({ orderId: membership.order_id, productId: membership.product_id });
    membershipsByTiming.set(source.timing_key, group);
  }

  const createdBatchIds = [];
  for (const [timingKey, group] of [...membershipsByTiming.entries()].sort(([a], [b]) =>
    a.localeCompare(b))) {
    const targetBatchId = createId();
    const sourceIds = [...group.sourceIds].sort();
    await client.query(`INSERT INTO fulfillment_batches
      (fulfillment_batch_id,buyer_group_id,timing_key,status,auto_attach)
      VALUES($1,$2,$3,'OPEN',true)`, [targetBatchId, targetGroupId, timingKey]);
    await client.query(`UPDATE fulfillment_batch_items
      SET fulfillment_batch_id=$2,assignment_mode='MANUAL_SEPARATE',updated_at=clock_timestamp()
      WHERE order_id=$1 AND fulfillment_batch_id=ANY($3::uuid[])`, [orderId, targetBatchId, sourceIds]);
    const updatedSources = (await client.query(`UPDATE fulfillment_batches SET
        revision=revision+1,updated_at=clock_timestamp()
      WHERE fulfillment_batch_id=ANY($1::uuid[])
      RETURNING fulfillment_batch_id,revision`, [sourceIds])).rows;
    const updatedRevision = new Map(updatedSources.map(row => [row.fulfillment_batch_id, Number(row.revision)]));
    await recordBuyerGroupingEvent(client, {
      eventType: 'SEPARATE',
      fulfillmentBatchId: targetBatchId,
      sourceBatchId: sourceIds.length === 1 ? sourceIds[0] : null,
      targetBatchId,
      items: group.items,
      revisions: {
        sources: sourceIds.map(batchId => ({
          batchId,
          before: Number(sourceById.get(batchId).revision),
          after: updatedRevision.get(batchId),
        })),
        targetAfter: 1,
      },
      context: { reason: 'BUYER_GROUP_SEPARATE', sourceGroupId, targetGroupId, orderId },
    });
    createdBatchIds.push(targetBatchId);
  }
  return createdBatchIds;
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
    await client.query('SELECT pg_advisory_xact_lock($1)', [FULFILLMENT_LOCK]);
    const sourceBatches = await assertBuyerGroupReassignmentAllowed(client, {
      action,
      orderId,
      previousGroupId,
    });

    if (action === 'MERGE') {
      const target = (await client.query(`SELECT buyer_group_id FROM buyer_groups
        WHERE buyer_group_id=$1 FOR UPDATE`, [targetBuyerGroupId])).rows[0];
      if (!target) throw Object.assign(new Error('El comprador seleccionado ya no existe.'), { status: 404 });
      if (previousGroupId !== targetBuyerGroupId) {
        await reconcileBuyerGroupMerge(client, {
          sourceGroupId: previousGroupId,
          targetGroupId: targetBuyerGroupId,
          sourceBatches,
        });
        await client.query(`UPDATE buyer_group_orders
          SET buyer_group_id=$2, assignment_mode='MANUAL_MERGE',
              auto_match_blocked=false, updated_at=clock_timestamp()
          WHERE buyer_group_id=$1`, [previousGroupId, targetBuyerGroupId]);
      }
    } else if (action === 'SEPARATE') {
      if (current.assignment_mode !== 'MANUAL_SEPARATE' || !current.auto_match_blocked) {
        const buyerGroupId = await createGroup(client, order.order_snapshot?.buyer || {});
        await reconcileBuyerGroupSeparation(client, {
          orderId,
          sourceGroupId: previousGroupId,
          targetGroupId: buyerGroupId,
          sourceBatches,
        });
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
        )
        AND NOT EXISTS (
          SELECT 1 FROM fulfillment_batches batch
          WHERE batch.buyer_group_id=g.buyer_group_id
        )`, [previousGroupId]);

    return (await client.query(`SELECT m.*, g.display_name, g.display_phone
      FROM buyer_group_orders m
      JOIN buyer_groups g USING (buyer_group_id)
      WHERE m.order_id=$1`, [orderId])).rows[0];
  });
}
