import { database, inventoryTransaction, snapshotWithReservation } from './inventory-database.mjs';
import { PICKUP_RULES } from './commerce.mjs';
import { deriveOrderFulfillmentParts, orderFulfillmentPart, SCHEDULABLE_ORDER_STATUSES } from './order-fulfillments.mjs';
import { queueOrderNotifications } from './seller-notifications.mjs';
import { readItemPaymentDecisions } from './item-payment-decisions.mjs';

const conflict = message => Object.assign(new Error(message), { status: 409 });
const windows = PICKUP_RULES.mainPickup;
const todayLocal = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: PICKUP_RULES.timezone,
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const timeLocal = (now = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: PICKUP_RULES.timezone,
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
const dateAt = value => new Date(`${value}T12:00:00Z`);
const addDay = value => new Date(dateAt(value).getTime() + 86400000).toISOString().slice(0, 10);

// Ignore cancelled/completed orders and expired holds in capacity and agendas.
// Expiration remains passive: no reservation, payment or inventory writes here.
const activeOrderSql = alias => `${alias}.order_snapshot->>'status' IN (${SCHEDULABLE_ORDER_STATUSES.map(status => `'${status}'`).join(',')})
  AND COALESCE(${alias}.order_snapshot->>'reservationState','') <> 'EXPIRED'
  AND (${alias}.committed_at IS NOT NULL OR ${alias}.expires_at IS NULL OR ${alias}.expires_at>clock_timestamp())`;

const appointmentJson = row => row ? {
  timingKey: row.timing_key,
  slotKey: row.slot_key,
  status: row.status,
  revision: row.revision,
  itemIds: row.item_ids ?? null,
  updatedAt: new Date(row.updated_at).getTime(),
} : null;

export function pickupEligible(order, timingKey) {
  if (timingKey) return Boolean(orderFulfillmentPart(order, timingKey)?.schedulingEligible);
  const parts = deriveOrderFulfillmentParts(order);
  return parts.length > 0 && parts.every(part => part.schedulingEligible);
}

export function pickupSlotKeys(order, timingKey, today, currentTime, decisions = []) {
  const now = new Date();
  today ??= todayLocal(now);
  currentTime ??= timeLocal(now);
  const part = orderFulfillmentPart(order, timingKey, decisions);
  if (!part?.schedulingEligible) return [];
  const delayed = timingKey !== 'IMMEDIATE';
  const start = delayed
    ? [part.pickupWindow?.startDate, PICKUP_RULES.delayedPickup.startDate].filter(Boolean).sort().at(-1)
    : windows.startDate;
  const end = delayed
    ? [part.pickupWindow?.endDate, PICKUP_RULES.delayedPickup.endDate].filter(Boolean).sort()[0]
    : windows.endDate;
  const result = [];
  for (let day = start; day <= end; day = addDay(day)) {
    if (day < today) continue;
    const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dateAt(day).getUTCDay()];
    const times = PICKUP_RULES.exceptions[day] || windows[weekday] || [];
    for (const [from, to] of times) {
      for (let hour = Number(from.slice(0, 2)); hour < Number(to.slice(0, 2)); hour++) {
        const startTime = `${String(hour).padStart(2, '0')}:00`;
        const endTime = `${String(hour + 1).padStart(2, '0')}:00`;
        if (day === today && startTime <= currentTime) continue;
        result.push(`${day}|${startTime}-${endTime}`);
      }
    }
  }
  return result;
}

export async function pickupAvailability(order, timingKey, appointment = null, decisions = []) {
  const keys = pickupSlotKeys(order, timingKey, undefined, undefined, decisions);
  if (!keys.length) return [];
  // Half-day appointments occupy every hourly slot they overlap. Excluding this
  // timing part also lets its buyer replace a legacy window when it is full.
  const { rows } = await database().pool.query(`SELECT candidate.slot_key, count(a.order_id)::int AS occupied,
    EXISTS(SELECT 1 FROM pickup_blackouts b
      WHERE b.pickup_date=split_part(candidate.slot_key,'|',1)::date
        AND b.start_time<split_part(split_part(candidate.slot_key,'|',2),'-',2)::time
        AND b.end_time>split_part(split_part(candidate.slot_key,'|',2),'-',1)::time) AS blocked
    FROM unnest($1::text[]) AS candidate(slot_key)
    LEFT JOIN pickup_appointments a ON a.status='SCHEDULED'
      AND EXISTS (SELECT 1 FROM checkout_attempts c WHERE c.order_id=a.order_id AND ${activeOrderSql('c')})
      AND split_part(a.slot_key,'|',1)=split_part(candidate.slot_key,'|',1)
      AND split_part(split_part(a.slot_key,'|',2),'-',1)<split_part(split_part(candidate.slot_key,'|',2),'-',2)
      AND split_part(split_part(a.slot_key,'|',2),'-',2)>split_part(split_part(candidate.slot_key,'|',2),'-',1)
      AND NOT (a.order_id=$2 AND a.timing_key=$3)
    GROUP BY candidate.slot_key`, [keys, order.id, timingKey]);
  const counts = new Map(rows.map(row => [row.slot_key, Number(row.occupied)]));
  const blocked = new Set(rows.filter(row => row.blocked).map(row => row.slot_key));
  return keys.filter(key => !blocked.has(key)).map(key => ({ key, remaining: Math.max(0, PICKUP_RULES.defaultCapacityPerWindow - (counts.get(key) || 0)),
    selected: appointment?.status === 'SCHEDULED' && appointment.slotKey === key }));
}

export async function getPickupAppointments(orderId) {
  const rows = (await database().pool.query(`SELECT * FROM pickup_appointments
    WHERE order_id=$1 ORDER BY timing_key`, [orderId])).rows;
  return rows.map(appointmentJson);
}

export async function pickupFulfillments(order) {
  // Private order/Blob snapshots and audit snapshots may be stale. Eligibility
  // reads the authoritative SQL snapshot; the mutation rechecks it under lock.
  const row = (await database().pool.query('SELECT * FROM checkout_attempts WHERE order_id=$1', [order.id])).rows[0];
  if (!row) throw Object.assign(new Error('Pedido no encontrado.'), { status: 404 });
  order = snapshotWithReservation(row);
  const decisions = await readItemPaymentDecisions(order.id);
  const appointments = new Map((await getPickupAppointments(order.id))
    .map(appointment => [appointment.timingKey, appointment]));
  return Promise.all(deriveOrderFulfillmentParts(order, decisions).map(async part => {
    const appointment = appointments.get(part.timingKey) || null;
    return {
      ...part,
      appointment,
      slots: await pickupAvailability(order, part.timingKey, appointment, decisions),
    };
  }));
}

export async function changePickup({ orderId, timingKey, slotKey, actor, itemIds, expectedRevision }, dependencies = {}) {
  if (!['ADMIN', 'CUSTOMER'].includes(actor)) throw conflict('Acceso no autorizado.');
  const normalizedTimingKey = String(timingKey || '').trim();
  if (!normalizedTimingKey) throw Object.assign(new Error('Falta el tipo de retiro.'), { status: 400 });
  const runTransaction = dependencies.transaction || inventoryTransaction;
  const queueNotifications = dependencies.queueNotifications || queueOrderNotifications;
  const allowedSlotKeys = dependencies.slotKeys || pickupSlotKeys;
  return runTransaction(async client => {
    const orderRow = (await client.query('SELECT * FROM checkout_attempts WHERE order_id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!orderRow) throw Object.assign(new Error('Pedido no encontrado.'), { status: 404 });
    const order = snapshotWithReservation(orderRow);
    const decisions = await readItemPaymentDecisions(orderId, client);
    const part = orderFulfillmentPart(order, normalizedTimingKey, decisions);
    if (!part) throw Object.assign(new Error('El tipo de retiro no pertenece a este pedido.'), { status: 404 });
    const existing = (await client.query(`SELECT * FROM pickup_appointments
      WHERE order_id=$1 AND timing_key=$2 FOR UPDATE`, [orderId, normalizedTimingKey])).rows[0];
    const oldKey = existing?.status === 'SCHEDULED' ? existing.slot_key : null;
    const membership = itemIds === undefined
      ? existing?.item_ids ?? part.itemIds
      : itemIds;
    if (expectedRevision !== undefined && expectedRevision !== (existing?.revision ?? 0)) {
      throw conflict('El retiro cambió. Actualizá la página antes de continuar.');
    }
    if (slotKey != null && !part.schedulingEligible) {
      throw conflict('Para agendar, Admin debe confirmar el pago total de cada artículo inmediato o la seña acordada de cada artículo posterior. Subir un comprobante no habilita el retiro. Revisá también si la reserva sigue activa.');
    }
    if (slotKey != null && (!Array.isArray(membership) || !membership.length ||
        new Set(membership).size !== membership.length || membership.some(id => !part.schedulableItemIds.includes(id)))) {
      throw conflict('Seleccioná únicamente artículos con el pago requerido confirmado y asignado por Admin.');
    }
    const sameMembership = existing?.item_ids == null ? itemIds === undefined :
      Array.isArray(membership) && [...existing.item_ids].sort().join('\0') === [...membership].sort().join('\0');
    if (slotKey === oldKey && sameMembership) return appointmentJson(existing);
    if (slotKey != null && (typeof slotKey !== 'string' || !slotKey)) {
      throw conflict('El horario de retiro no está disponible para esta parte del pedido.');
    }
    if (slotKey == null && !oldKey) return existing ? appointmentJson(existing) : null;
    // Every mutation on a date shares one row lock, even when the slot keys
    // differ or a legacy half-day range overlaps several new hourly ranges.
    // Sort source/destination dates to keep moves between dates deadlock-safe.
    const days = [...new Set([oldKey, slotKey].filter(Boolean).map(key => key.split('|')[0]))].sort();
    for (const day of days) {
      await client.query('INSERT INTO pickup_windows(slot_key) VALUES($1) ON CONFLICT DO NOTHING', [day]);
      await client.query('SELECT slot_key FROM pickup_windows WHERE slot_key=$1 FOR UPDATE', [day]);
    }
    if (slotKey) {
      // Recheck the current time after any wait for a shared date lock.
      if (!allowedSlotKeys(order, normalizedTimingKey, undefined, undefined, decisions).includes(slotKey)) {
        throw conflict('El horario de retiro no está disponible para esta parte del pedido.');
      }
      // Use the same date lock as blackout confirmation. Never expose private reasons.
      const blocked = (await client.query(`SELECT id FROM pickup_blackouts
        WHERE pickup_date=split_part($1,'|',1)::date
          AND start_time<split_part(split_part($1,'|',2),'-',2)::time
          AND end_time>split_part(split_part($1,'|',2),'-',1)::time LIMIT 1`, [slotKey])).rows.length;
      if (blocked) throw conflict('Este horario está bloqueado. Elegí otro.');
      await client.query('INSERT INTO pickup_windows(slot_key) VALUES($1) ON CONFLICT DO NOTHING', [slotKey]);
      const occupied = Number((await client.query(`SELECT count(*)::int AS count FROM pickup_appointments
        WHERE status='SCHEDULED' AND split_part(slot_key,'|',1)=split_part($1,'|',1)
          AND EXISTS (SELECT 1 FROM checkout_attempts c WHERE c.order_id=pickup_appointments.order_id AND ${activeOrderSql('c')})
          AND split_part(split_part(slot_key,'|',2),'-',1)<split_part(split_part($1,'|',2),'-',2)
          AND split_part(split_part(slot_key,'|',2),'-',2)>split_part(split_part($1,'|',2),'-',1)
          AND NOT (order_id=$2 AND timing_key=$3)`, [slotKey, orderId, normalizedTimingKey])).rows[0].count);
      if (occupied >= PICKUP_RULES.defaultCapacityPerWindow) throw conflict('Este horario ya está completo. Elegí otro.');
    }
    const row = (await client.query(`INSERT INTO pickup_appointments(order_id,timing_key,slot_key,status,changed_by,item_ids)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id,timing_key) DO UPDATE SET slot_key=EXCLUDED.slot_key,
      item_ids=EXCLUDED.item_ids,
      status=EXCLUDED.status,changed_by=EXCLUDED.changed_by,revision=pickup_appointments.revision+1,
      updated_at=clock_timestamp() RETURNING *`, [orderId, normalizedTimingKey, slotKey,
      slotKey ? 'SCHEDULED' : 'CANCELLED', actor, slotKey ? membership : existing?.item_ids ?? null])).rows[0];
    if (slotKey) await queueNotifications(client, {
      key: `pickup:${orderId}:${normalizedTimingKey}:${row.revision}`, order,
      type: oldKey ? 'PICKUP_CHANGED' : 'PICKUP_SCHEDULED',
      details: { oldSlot: oldKey, slot: slotKey, actor,
        timingKey: normalizedTimingKey, timingLabel: part.timingLabel, appointmentRevision: row.revision,
        itemIds: membership },
    });
    return appointmentJson(row);
  });
}

export async function listUpcomingPickups({ client = database().pool, now = new Date() } = {}) {
  const { rows } = await client.query(`SELECT a.slot_key, a.order_id, a.timing_key, a.item_ids, c.order_snapshot,
    EXISTS(SELECT 1 FROM pickup_blackouts b
      WHERE b.pickup_date=split_part(a.slot_key,'|',1)::date
        AND b.start_time<split_part(split_part(a.slot_key,'|',2),'-',2)::time
        AND b.end_time>split_part(split_part(a.slot_key,'|',2),'-',1)::time) AS needs_reschedule
    FROM pickup_appointments a JOIN checkout_attempts c ON c.order_id=a.order_id
    WHERE a.status='SCHEDULED' AND ${activeOrderSql('c')} AND (split_part(a.slot_key,'|',1)>$1
      OR (split_part(a.slot_key,'|',1)=$1 AND split_part(split_part(a.slot_key,'|',2),'-',2)>$2))
    ORDER BY a.slot_key, a.order_id, a.timing_key`, [todayLocal(now), timeLocal(now)]);
  return rows.map(row => {
    const part = orderFulfillmentPart(row.order_snapshot, row.timing_key);
    const members = (part?.items || []).filter(item => row.item_ids == null || row.item_ids.includes(item.productId));
    return { slotKey: row.slot_key, orderId: row.order_id, timingKey: row.timing_key,
      needsReschedule: Boolean(row.needs_reschedule),
      timingLabel: part?.timingLabel || row.timing_key,
      buyer: row.order_snapshot.buyer?.name || '',
      buyerPhone: row.order_snapshot.buyer?.phone || '',
      items: members.map(item => ({ productId: item.productId,
        itemNumber: item.itemNumber, quantity: item.quantity })),
      itemNumbers: members.map(item => item.itemNumber) };
  });
}
