import { randomUUID } from 'node:crypto';
import { database, inventoryTransaction } from './inventory-database.mjs';
import { ensureAllBuyerGroups } from './buyer-groups.mjs';
import {
  assertExpectedRevision,
  explicitProductIds,
  nextStatus,
  normalizeProductId,
  orderItems,
  timingKeyForItem,
  timingLabel,
} from './fulfillment-batches-core.mjs';

const FULFILLMENT_LOCK = 202610060324;
const conflict = (message, code = 'FULFILLMENT_CONFLICT') =>
  Object.assign(new Error(message), { status: 409, code });

function publicBatch(row) {
  return {
    fulfillmentBatchId: row.fulfillment_batch_id,
    buyerGroupId: row.buyer_group_id,
    displayName: row.display_name,
    displayPhone: row.display_phone,
    timingKey: row.timing_key,
    timingLabel: timingLabel(row.timing_key),
    status: row.status,
    autoAttach: row.auto_attach,
    revision: Number(row.revision),
    preparedAt: row.prepared_at ? new Date(row.prepared_at).getTime() : null,
    deliveredAt: row.delivered_at ? new Date(row.delivered_at).getTime() : null,
    mergedIntoBatchId: row.merged_into_batch_id,
    createdAt: new Date(row.batch_created_at).getTime(),
    updatedAt: new Date(row.batch_updated_at).getTime(),
    items: [],
  };
}

export async function loadFulfillmentBatches(client, batchIds = null) {
  const rows = (await client.query(`SELECT
      batch.fulfillment_batch_id,
      batch.buyer_group_id,
      batch.timing_key,
      batch.status,
      batch.auto_attach,
      batch.revision,
      batch.prepared_at,
      batch.delivered_at,
      batch.merged_into_batch_id,
      batch.created_at AS batch_created_at,
      batch.updated_at AS batch_updated_at,
      buyer.display_name,
      buyer.display_phone,
      membership.order_id,
      membership.product_id,
      membership.assignment_mode,
      attempt.order_snapshot,
      attempt.created_at AS order_created_at
    FROM fulfillment_batches batch
    JOIN buyer_groups buyer USING (buyer_group_id)
    LEFT JOIN fulfillment_batch_items membership USING (fulfillment_batch_id)
    LEFT JOIN checkout_attempts attempt USING (order_id)
    WHERE ($1::uuid[] IS NULL OR batch.fulfillment_batch_id = ANY($1::uuid[]))
    ORDER BY lower(buyer.display_name), batch.created_at, batch.fulfillment_batch_id,
      attempt.created_at, membership.order_id, membership.product_id`, [batchIds])).rows;

  const batches = new Map();
  for (const row of rows) {
    const batch = batches.get(row.fulfillment_batch_id) || publicBatch(row);
    if (row.order_id != null && row.product_id != null) {
      const item = orderItems(row.order_snapshot).find(
        candidate => normalizeProductId(candidate?.productId) === row.product_id
      );
      const title = typeof item?.title === 'string' && item.title.trim()
        ? item.title
        : `Producto ${row.product_id || 'sin identificador'}`;
      const quantity = item?.quantity == null ? null : Number(item.quantity);
      batch.items.push({
        orderId: row.order_id,
        productId: row.product_id,
        itemNumber: item?.itemNumber ?? null,
        title,
        quantity: Number.isFinite(quantity) ? quantity : null,
        saleMode: item?.saleMode || (row.timing_key === 'IMMEDIATE' ? 'IMMEDIATE' : 'DELAYED'),
        pickupWindowStart: item?.pickupWindowStart || null,
        pickupWindowEnd: item?.pickupWindowEnd || null,
        assignmentMode: row.assignment_mode,
        orderCreatedAt: row.order_created_at ? new Date(row.order_created_at).getTime() : null,
      });
    }
    batches.set(row.fulfillment_batch_id, batch);
  }
  return [...batches.values()];
}

async function lockFulfillment(client) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [FULFILLMENT_LOCK]);
}

export async function ensureFulfillmentAssignments(client, dependencies = {}) {
  const ensureBuyerGroups = dependencies.ensureBuyerGroups || ensureAllBuyerGroups;
  const createId = dependencies.createId || randomUUID;
  await ensureBuyerGroups(client);
  await lockFulfillment(client);
  const orders = (await client.query(`SELECT
      attempt.order_id,
      attempt.order_snapshot,
      membership.buyer_group_id
    FROM checkout_attempts attempt
    JOIN buyer_group_orders membership USING (order_id)
    WHERE attempt.committed_at IS NOT NULL
      AND COALESCE(attempt.order_snapshot->>'status', '') <> 'CANCELLED'
    ORDER BY attempt.created_at, attempt.order_id`)).rows;

  let assigned = 0;
  const createdBatchIds = new Set();
  const touchedExistingBatchIds = new Set();
  for (const order of orders) {
    for (const item of orderItems(order.order_snapshot)) {
      const productId = normalizeProductId(item?.productId);
      if (!productId) continue;
      const existing = (await client.query(`SELECT fulfillment_batch_id
        FROM fulfillment_batch_items
        WHERE order_id=$1 AND product_id=$2`, [order.order_id, productId])).rows[0];
      if (existing) continue;

      const timingKey = timingKeyForItem(item);
      let batch = (await client.query(`SELECT * FROM fulfillment_batches
        WHERE buyer_group_id=$1 AND timing_key=$2
          AND status='OPEN' AND auto_attach=true AND merged_into_batch_id IS NULL
        FOR UPDATE`, [order.buyer_group_id, timingKey])).rows[0];
      let assignmentMode = 'AUTO_MATCH';

      if (!batch) {
        const fulfillmentBatchId = createId();
        batch = (await client.query(`INSERT INTO fulfillment_batches
          (fulfillment_batch_id,buyer_group_id,timing_key,status,auto_attach)
          VALUES($1,$2,$3,'OPEN',true)
          RETURNING *`, [fulfillmentBatchId, order.buyer_group_id, timingKey])).rows[0];
        assignmentMode = 'AUTO_NEW';
        createdBatchIds.add(batch.fulfillment_batch_id);
      }

      const result = await client.query(`INSERT INTO fulfillment_batch_items
        (order_id,product_id,fulfillment_batch_id,assignment_mode)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(order_id,product_id) DO NOTHING`, [
        order.order_id,
        productId,
        batch.fulfillment_batch_id,
        assignmentMode,
      ]);
      const inserted = Number(result.rowCount || 0);
      if (inserted && assignmentMode === 'AUTO_MATCH' &&
          !createdBatchIds.has(batch.fulfillment_batch_id)) {
        touchedExistingBatchIds.add(batch.fulfillment_batch_id);
      }
      assigned += inserted;
    }
  }
  for (const fulfillmentBatchId of [...touchedExistingBatchIds].sort()) {
    await client.query(`UPDATE fulfillment_batches
      SET revision=revision+1,updated_at=clock_timestamp()
      WHERE fulfillment_batch_id=$1`, [fulfillmentBatchId]);
  }
  return assigned;
}

export async function listFulfillmentBatches() {
  return inventoryTransaction(async client => {
    await ensureFulfillmentAssignments(client);
    return loadFulfillmentBatches(client);
  });
}

async function lockBatches(client, batchIds) {
  const unique = [...new Set(batchIds)].sort();
  const rows = (await client.query(`SELECT * FROM fulfillment_batches
    WHERE fulfillment_batch_id = ANY($1::uuid[])
    ORDER BY fulfillment_batch_id
    FOR UPDATE`, [unique])).rows;
  if (rows.length !== unique.length) {
    throw Object.assign(new Error('No se encontró uno de los lotes.'), { status: 404 });
  }
  return new Map(rows.map(row => [row.fulfillment_batch_id, row]));
}

async function affectedItems(client, batchId) {
  return (await client.query(`SELECT order_id,product_id
    FROM fulfillment_batch_items
    WHERE fulfillment_batch_id=$1
    ORDER BY order_id,product_id`, [batchId])).rows.map(row => ({
    orderId: row.order_id,
    productId: row.product_id,
  }));
}

async function recordEvent(client, {
  eventType,
  fulfillmentBatchId = null,
  sourceBatchId = null,
  targetBatchId = null,
  items = [],
  revisions = {},
  context = {},
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

async function transitionBatch(client, { batchId, action, expectedRevision }) {
  const rows = await lockBatches(client, [batchId]);
  const batch = rows.get(batchId);
  if (batch.merged_into_batch_id) throw conflict('Este lote ya fue combinado con otro.');
  assertExpectedRevision({ revision: batch.revision }, expectedRevision);
  const status = nextStatus(batch.status, action);

  if (action === 'REOPEN') {
    const competing = (await client.query(`SELECT fulfillment_batch_id
      FROM fulfillment_batches
      WHERE buyer_group_id=$1 AND timing_key=$2
        AND status='OPEN' AND auto_attach=true AND merged_into_batch_id IS NULL
        AND fulfillment_batch_id<>$3
      FOR UPDATE`, [batch.buyer_group_id, batch.timing_key, batchId])).rows[0];
    if (competing) {
      throw conflict('Ya existe otro lote abierto para este comprador y tipo de retiro. Combiná los lotes en su lugar.');
    }
  }

  const items = await affectedItems(client, batchId);
  const updated = (await client.query(`UPDATE fulfillment_batches SET
      status=$2,
      auto_attach=$3,
      prepared_at=CASE WHEN $4='PREPARE' THEN clock_timestamp()
        WHEN $4='REOPEN' THEN NULL ELSE prepared_at END,
      delivered_at=CASE WHEN $4='DELIVER' THEN clock_timestamp() ELSE delivered_at END,
      revision=revision+1,
      updated_at=clock_timestamp()
    WHERE fulfillment_batch_id=$1
    RETURNING *`, [batchId, status, status === 'OPEN', action])).rows[0];

  await recordEvent(client, {
    eventType: action,
    fulfillmentBatchId: batchId,
    targetBatchId: batchId,
    items,
    revisions: { before: Number(batch.revision), after: Number(updated.revision) },
  });
  return loadFulfillmentBatches(client, [batchId]);
}

export async function combineBatches(client, {
  batchId,
  targetBatchId,
  expectedRevision,
  expectedTargetRevision,
  confirmFrozen,
}) {
  if (batchId === targetBatchId) throw conflict('Seleccioná otro lote para combinar.');
  const rows = await lockBatches(client, [batchId, targetBatchId]);
  const source = rows.get(batchId);
  const target = rows.get(targetBatchId);
  assertExpectedRevision({ revision: source.revision }, expectedRevision);
  assertExpectedRevision({ revision: target.revision }, expectedTargetRevision);
  if (source.merged_into_batch_id || target.merged_into_batch_id) {
    throw conflict('Uno de los lotes ya fue combinado.');
  }
  if (source.buyer_group_id !== target.buyer_group_id || source.timing_key !== target.timing_key) {
    throw conflict('Solo se pueden combinar lotes del mismo comprador y tipo de retiro.');
  }
  if (source.status === 'DELIVERED' || target.status === 'DELIVERED') {
    throw conflict('Los lotes entregados no se pueden combinar.');
  }
  if ((source.status !== 'OPEN' || target.status !== 'OPEN') && confirmFrozen !== true) {
    throw conflict('Confirmá expresamente el cambio de los lotes congelados.');
  }

  const items = await affectedItems(client, batchId);
  await client.query(`UPDATE fulfillment_batch_items
    SET fulfillment_batch_id=$2,assignment_mode='MANUAL_COMBINE',updated_at=clock_timestamp()
    WHERE fulfillment_batch_id=$1`, [batchId, targetBatchId]);
  const updatedSource = (await client.query(`UPDATE fulfillment_batches SET
      auto_attach=false,merged_into_batch_id=$2,revision=revision+1,updated_at=clock_timestamp()
    WHERE fulfillment_batch_id=$1 RETURNING *`, [batchId, targetBatchId])).rows[0];
  const updatedTarget = (await client.query(`UPDATE fulfillment_batches SET
      auto_attach=CASE WHEN status='OPEN' THEN auto_attach OR $2 ELSE false END,
      revision=revision+1,updated_at=clock_timestamp()
    WHERE fulfillment_batch_id=$1 RETURNING *`, [targetBatchId, source.auto_attach])).rows[0];
  await recordEvent(client, {
    eventType: 'COMBINE',
    fulfillmentBatchId: targetBatchId,
    sourceBatchId: batchId,
    targetBatchId,
    items,
    revisions: {
      sourceBefore: Number(source.revision),
      sourceAfter: Number(updatedSource.revision),
      targetBefore: Number(target.revision),
      targetAfter: Number(updatedTarget.revision),
    },
  });
  return loadFulfillmentBatches(client, [batchId, targetBatchId]);
}

export async function separateItems(client, {
  batchId,
  orderId,
  productIds,
  expectedRevision,
  confirmFrozen,
}) {
  const rows = await lockBatches(client, [batchId]);
  const source = rows.get(batchId);
  assertExpectedRevision({ revision: source.revision }, expectedRevision);
  if (source.merged_into_batch_id) throw conflict('Este lote ya fue combinado con otro.');
  if (source.status !== 'OPEN' && confirmFrozen !== true) {
    throw conflict('Confirmá expresamente el cambio del lote congelado.');
  }

  const selectedProductIds = explicitProductIds(productIds);
  const selected = (await client.query(`SELECT order_id,product_id
    FROM fulfillment_batch_items
    WHERE fulfillment_batch_id=$1 AND order_id=$2
      AND product_id = ANY($3::text[])
    ORDER BY product_id
    FOR UPDATE`, [batchId, orderId, selectedProductIds])).rows;
  if (selected.length !== selectedProductIds.length) {
    throw conflict('Uno o más artículos seleccionados no pertenecen a este pedido y lote.',
      'FULFILLMENT_ITEMS_NOT_FOUND');
  }

  const newBatchId = randomUUID();
  await client.query(`INSERT INTO fulfillment_batches
    (fulfillment_batch_id,buyer_group_id,timing_key,status,auto_attach,prepared_at,delivered_at)
    VALUES($1,$2,$3,$4,false,$5,$6)`, [
    newBatchId,
    source.buyer_group_id,
    source.timing_key,
    source.status,
    source.prepared_at,
    source.delivered_at,
  ]);
  await client.query(`UPDATE fulfillment_batch_items
    SET fulfillment_batch_id=$2,assignment_mode='MANUAL_SEPARATE',updated_at=clock_timestamp()
    WHERE fulfillment_batch_id=$1 AND order_id=$3
      AND product_id = ANY($4::text[])`, [
    batchId,
    newBatchId,
    orderId,
    selectedProductIds,
  ]);
  const updatedSource = (await client.query(`UPDATE fulfillment_batches SET
      revision=revision+1,updated_at=clock_timestamp()
    WHERE fulfillment_batch_id=$1 RETURNING *`, [batchId])).rows[0];
  const items = selected.map(row => ({ orderId: row.order_id, productId: row.product_id }));
  await recordEvent(client, {
    eventType: 'SEPARATE',
    fulfillmentBatchId: newBatchId,
    sourceBatchId: batchId,
    targetBatchId: newBatchId,
    items,
    revisions: {
      sourceBefore: Number(source.revision),
      sourceAfter: Number(updatedSource.revision),
      targetAfter: 1,
    },
  });
  return loadFulfillmentBatches(client, [batchId, newBatchId]);
}

export async function mutateFulfillmentBatch(args) {
  return inventoryTransaction(async client => {
    await ensureFulfillmentAssignments(client);
    const action = String(args?.action || '').toUpperCase();
    if (['PREPARE', 'DELIVER', 'REOPEN'].includes(action)) {
      return transitionBatch(client, { ...args, action });
    }
    if (action === 'COMBINE') return combineBatches(client, args);
    if (action === 'SEPARATE') return separateItems(client, args);
    throw Object.assign(new Error('Acción de lote no válida.'), { status: 400 });
  });
}

export async function fulfillmentBatchEvents(batchId) {
  return (await database().pool.query(`SELECT * FROM fulfillment_batch_events
    WHERE fulfillment_batch_id=$1 OR source_batch_id=$1 OR target_batch_id=$1
    ORDER BY created_at,event_id`, [batchId])).rows;
}
