import { database, inventoryTransaction } from './inventory-database.mjs';
import { PICKUP_RULES } from './commerce.mjs';
import { deriveOrderFulfillmentParts, orderFulfillmentPart } from './order-fulfillments.mjs';
import { queueOrderNotifications } from './seller-notifications.mjs';

const conflict = message => Object.assign(new Error(message), { status: 409 });
const windows = PICKUP_RULES.mainPickup;
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: PICKUP_RULES.timezone,
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const timeLocal = () => new Intl.DateTimeFormat('en-GB', { timeZone: PICKUP_RULES.timezone,
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const dateAt = value => new Date(`${value}T12:00:00Z`);
const addDay = value => new Date(dateAt(value).getTime() + 86400000).toISOString().slice(0, 10);

const appointmentJson = row => row ? {
  timingKey: row.timing_key,
  slotKey: row.slot_key,
  status: row.status,
  revision: row.revision,
  updatedAt: new Date(row.updated_at).getTime(),
} : null;

export function pickupEligible(order, timingKey) {
  if (timingKey) return Boolean(orderFulfillmentPart(order, timingKey)?.eligible);
  const parts = deriveOrderFulfillmentParts(order);
  return parts.length > 0 && parts.every(part => part.eligible);
}

export function pickupSlotKeys(order, timingKey, today = todayLocal()) {
  const part = orderFulfillmentPart(order, timingKey);
  if (!part?.eligible) return [];
  const delayed = timingKey !== 'IMMEDIATE';
  const start = delayed
    ? part.pickupWindow?.startDate || PICKUP_RULES.delayedPickup.startDate
    : windows.startDate;
  const end = delayed
    ? part.pickupWindow?.endDate || PICKUP_RULES.delayedPickup.endDate
    : windows.endDate;
  const result = [];
  const currentTime = timeLocal();
  for (let day = start; day <= end; day = addDay(day)) {
    if (day < today) continue;
    const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dateAt(day).getUTCDay()];
    const times = PICKUP_RULES.exceptions[day] || windows[weekday] || [];
    for (const [from, to] of times) {
      if (day === today && from <= currentTime) continue;
      result.push(`${day}|${from}-${to}`);
    }
  }
  return result;
}

export async function pickupAvailability(order, timingKey, appointment = null) {
  const keys = pickupSlotKeys(order, timingKey);
  if (!keys.length) return [];
  const { rows } = await database().pool.query(`SELECT slot_key, count(*)::int AS occupied
    FROM pickup_appointments WHERE status='SCHEDULED' AND slot_key=ANY($1::text[]) GROUP BY slot_key`, [keys]);
  const counts = new Map(rows.map(row => [row.slot_key, Number(row.occupied)]));
  return keys.map(key => ({ key, remaining: Math.max(0, PICKUP_RULES.defaultCapacityPerWindow - (counts.get(key) || 0)),
    selected: appointment?.status === 'SCHEDULED' && appointment.slotKey === key }));
}

export async function getPickupAppointments(orderId) {
  const rows = (await database().pool.query(`SELECT * FROM pickup_appointments
    WHERE order_id=$1 ORDER BY timing_key`, [orderId])).rows;
  return rows.map(appointmentJson);
}

export async function pickupFulfillments(order) {
  const appointments = new Map((await getPickupAppointments(order.id))
    .map(appointment => [appointment.timingKey, appointment]));
  return Promise.all(deriveOrderFulfillmentParts(order).map(async part => {
    const appointment = appointments.get(part.timingKey) || null;
    return {
      ...part,
      appointment,
      slots: await pickupAvailability(order, part.timingKey, appointment),
    };
  }));
}

export async function changePickup({ orderId, timingKey, slotKey, actor }, dependencies = {}) {
  if (!['ADMIN', 'CUSTOMER'].includes(actor)) throw conflict('Acceso no autorizado.');
  const normalizedTimingKey = String(timingKey || '').trim();
  if (!normalizedTimingKey) throw Object.assign(new Error('Falta el tipo de retiro.'), { status: 400 });
  const runTransaction = dependencies.transaction || inventoryTransaction;
  const queueNotifications = dependencies.queueNotifications || queueOrderNotifications;
  const allowedSlotKeys = dependencies.slotKeys || pickupSlotKeys;
  return runTransaction(async client => {
    const orderRow = (await client.query('SELECT order_snapshot FROM checkout_attempts WHERE order_id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!orderRow) throw Object.assign(new Error('Pedido no encontrado.'), { status: 404 });
    const order = orderRow.order_snapshot;
    const part = orderFulfillmentPart(order, normalizedTimingKey);
    if (!part) throw Object.assign(new Error('El tipo de retiro no pertenece a este pedido.'), { status: 404 });
    const existing = (await client.query(`SELECT * FROM pickup_appointments
      WHERE order_id=$1 AND timing_key=$2 FOR UPDATE`, [orderId, normalizedTimingKey])).rows[0];
    const oldKey = existing?.status === 'SCHEDULED' ? existing.slot_key : null;
    if (slotKey === oldKey) return appointmentJson(existing);
    if (slotKey != null && !part.eligible) {
      throw conflict(normalizedTimingKey === 'IMMEDIATE'
        ? 'El retiro inmediato requiere que se complete el importe exigible ahora.'
        : 'El retiro posterior requiere el pago total confirmado por el vendedor.');
    }
    if (slotKey != null && !allowedSlotKeys(order, normalizedTimingKey).includes(slotKey)) {
      throw conflict('El horario de retiro no está disponible para esta parte del pedido.');
    }
    if (slotKey == null && !oldKey) return existing ? appointmentJson(existing) : null;
    if (slotKey) {
      await client.query('INSERT INTO pickup_windows(slot_key) VALUES($1) ON CONFLICT DO NOTHING', [slotKey]);
      await client.query('SELECT slot_key FROM pickup_windows WHERE slot_key=$1 FOR UPDATE', [slotKey]);
      const occupied = Number((await client.query(`SELECT count(*)::int AS count FROM pickup_appointments
        WHERE slot_key=$1 AND status='SCHEDULED'`, [slotKey])).rows[0].count);
      if (occupied >= PICKUP_RULES.defaultCapacityPerWindow) throw conflict('Este horario ya está completo. Elegí otro.');
    }
    const row = (await client.query(`INSERT INTO pickup_appointments(order_id,timing_key,slot_key,status,changed_by)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(order_id,timing_key) DO UPDATE SET slot_key=EXCLUDED.slot_key,
      status=EXCLUDED.status,changed_by=EXCLUDED.changed_by,revision=pickup_appointments.revision+1,
      updated_at=clock_timestamp() RETURNING *`, [orderId, normalizedTimingKey, slotKey,
      slotKey ? 'SCHEDULED' : 'CANCELLED', actor])).rows[0];
    if (slotKey) await queueNotifications(client, {
      key: `pickup:${orderId}:${normalizedTimingKey}:${row.revision}`, order,
      type: oldKey ? 'PICKUP_CHANGED' : 'PICKUP_SCHEDULED',
      details: { oldSlot: oldKey, slot: slotKey, actor,
        timingKey: normalizedTimingKey, timingLabel: part.timingLabel },
    });
    return appointmentJson(row);
  });
}

export async function listUpcomingPickups() {
  const { rows } = await database().pool.query(`SELECT a.slot_key, a.order_id, a.timing_key, c.order_snapshot
    FROM pickup_appointments a JOIN checkout_attempts c ON c.order_id=a.order_id
    WHERE a.status='SCHEDULED' AND split_part(a.slot_key,'|',1) >= $1
    ORDER BY a.slot_key, a.order_id, a.timing_key`, [todayLocal()]);
  return rows.map(row => {
    const part = orderFulfillmentPart(row.order_snapshot, row.timing_key);
    return { slotKey: row.slot_key, orderId: row.order_id, timingKey: row.timing_key,
      timingLabel: part?.timingLabel || row.timing_key,
      buyer: row.order_snapshot.buyer?.name || '',
      itemNumbers: part?.items.map(item => item.itemNumber) || [] };
  });
}
