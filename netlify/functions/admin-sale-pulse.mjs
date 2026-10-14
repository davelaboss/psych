import {
  adminAuthorized,
  jsonResponse,
  loadCatalog,
} from './_shared/commerce.mjs';
import { database } from './_shared/inventory-database.mjs';
import { deriveOrderFulfillmentParts } from './_shared/order-fulfillments.mjs';
import {
  ANALYTICS_RETENTION_DAYS,
  buildSalePulseSnapshot,
  paymentsRequiringAttention,
} from './_shared/sale-pulse.mjs';

function eventRow(row) {
  return {
    occurredAt: row.occurred_at,
    eventType: row.event_type,
    sessionHash: row.anonymous_session_hash,
    productId: row.product_id,
    campaignSource: row.campaign_source,
    category: row.category,
    filters: row.filter_context,
    resultPosition: row.result_position == null ? null : Number(row.result_position),
    resultCount: row.result_count == null ? null : Number(row.result_count),
  };
}

function operationalCounts(orderRows, appointmentRows, fulfillmentRows) {
  const appointments = new Map(appointmentRows.map((row) => [
    `${row.order_id}\0${row.timing_key}`,
    row,
  ]));
  const delivered = new Set(fulfillmentRows
    .filter((row) => row.all_delivered === true)
    .map((row) => `${row.order_id}\0${row.timing_key}`));
  let eligiblePickupsUnscheduled = 0;
  let scheduledPickupsPending = 0;

  for (const row of orderRows.filter((candidate) => candidate.committed_at)) {
    const order = { ...(row.order_snapshot || {}), id: row.order_id };
    for (const part of deriveOrderFulfillmentParts(order)) {
      const key = `${row.order_id}\0${part.timingKey}`;
      if (delivered.has(key)) continue;
      const scheduled = appointments.get(key)?.status === 'SCHEDULED';
      if (scheduled) scheduledPickupsPending += 1;
      else if (part.eligible) eligiblePickupsUnscheduled += 1;
    }
  }

  return {
    paymentsRequiringAttention: paymentsRequiringAttention(
      orderRows.map((row) => row.order_snapshot || {})
    ),
    eligiblePickupsUnscheduled,
    scheduledPickupsPending,
  };
}

export async function loadSalePulseSnapshot(origin, dependencies = {}) {
  const query = dependencies.query || ((sql, params) => database().pool.query(sql, params));
  const loadProducts = dependencies.loadProducts || loadCatalog;
  await query(`DELETE FROM sale_analytics_events
    WHERE occurred_at < clock_timestamp() - $1::interval`, [`${ANALYTICS_RETENTION_DAYS} days`]);

  const [trackingResult, eventResult, orderResult, appointmentResult, fulfillmentResult, products] = await Promise.all([
    query('SELECT min(occurred_at) AS tracking_started_at FROM sale_analytics_events'),
    query(`SELECT occurred_at,event_type,anonymous_session_hash,product_id,campaign_source,
        category,filter_context,result_position,result_count
      FROM sale_analytics_events
      WHERE occurred_at >= clock_timestamp() - interval '7 days'
      ORDER BY occurred_at,event_id`),
    query(`SELECT order_id,committed_at,order_snapshot
      FROM checkout_attempts ORDER BY created_at,order_id`),
    query(`SELECT order_id,timing_key,status
      FROM pickup_appointments`),
    query(`SELECT membership.order_id,batch.timing_key,
        bool_and(batch.status='DELIVERED') AS all_delivered
      FROM fulfillment_batch_items membership
      JOIN fulfillment_batches batch USING (fulfillment_batch_id)
      WHERE batch.merged_into_batch_id IS NULL
      GROUP BY membership.order_id,batch.timing_key`),
    loadProducts(origin),
  ]);

  const orderRows = orderResult.rows || [];
  return buildSalePulseSnapshot({
    events: (eventResult.rows || []).map(eventRow),
    products,
    orders: orderRows.filter((row) => row.committed_at).map((row) => ({
      committedAt: row.committed_at,
      items: Array.isArray(row.order_snapshot?.items) ? row.order_snapshot.items : [],
    })),
    operationalCounts: operationalCounts(
      orderRows,
      appointmentResult.rows || [],
      fulfillmentResult.rows || []
    ),
    trackingStartedAt: trackingResult.rows?.[0]?.tracking_started_at || null,
    generatedAt: Date.now(),
  });
}

export function createAdminSalePulseHandler({
  authorized = adminAuthorized,
  loadSnapshot = loadSalePulseSnapshot,
} = {}) {
  return async function handler(request) {
    if (!authorized(request)) {
      return jsonResponse({ error: 'Acceso no autorizado.' }, 401);
    }
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Método no permitido.' }, 405);
    }
    try {
      return jsonResponse({
        ok: true,
        salePulse: await loadSnapshot(new URL(request.url).origin),
      });
    } catch (error) {
      return jsonResponse({
        error: error instanceof Error ? error.message : 'No se pudo generar el pulso de venta.',
      }, 500);
    }
  };
}

export default createAdminSalePulseHandler();
