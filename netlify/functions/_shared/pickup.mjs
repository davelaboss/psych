import { database, inventoryTransaction } from './inventory-database.mjs';
import { PICKUP_RULES } from './commerce.mjs';
import { queueSellerNotification } from './seller-notifications.mjs';

const conflict = message => Object.assign(new Error(message), { status: 409 });
const windows = PICKUP_RULES.mainPickup;
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: PICKUP_RULES.timezone,
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const timeLocal = () => new Intl.DateTimeFormat('en-GB', { timeZone: PICKUP_RULES.timezone,
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const dateAt = value => new Date(`${value}T12:00:00Z`);
const addDay = value => new Date(dateAt(value).getTime() + 86400000).toISOString().slice(0, 10);

export function pickupEligible(order) {
  if (!order || order.status === 'CANCELLED' || Number(order.remainingBalancePYG) !== 0) return false;
  const delayed = order.items?.some(item => item.saleMode === 'DELAYED');
  return delayed ? order.status === 'PAID_IN_FULL' : order.status === 'PAYMENT_CONFIRMED';
}

export function pickupSlotKeys(order, today = todayLocal()) {
  if (!pickupEligible(order)) return [];
  const delayed = order.items.some(item => item.saleMode === 'DELAYED');
  const start = delayed ? PICKUP_RULES.delayedPickup.startDate : windows.startDate;
  const end = delayed ? PICKUP_RULES.delayedPickup.endDate : windows.endDate;
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

export async function pickupAvailability(order, appointment = null) {
  const keys = pickupSlotKeys(order);
  if (!keys.length) return [];
  const { rows } = await database().pool.query(`SELECT slot_key, count(*)::int AS occupied
    FROM pickup_appointments WHERE status='SCHEDULED' AND slot_key=ANY($1::text[]) GROUP BY slot_key`, [keys]);
  const counts = new Map(rows.map(row => [row.slot_key, Number(row.occupied)]));
  return keys.map(key => ({ key, remaining: Math.max(0, PICKUP_RULES.defaultCapacityPerWindow - (counts.get(key) || 0)),
    selected: appointment?.status === 'SCHEDULED' && appointment.slotKey === key }));
}

export async function getPickupAppointment(orderId) {
  const row = (await database().pool.query('SELECT * FROM pickup_appointments WHERE order_id=$1', [orderId])).rows[0];
  return row ? { slotKey: row.slot_key, status: row.status, revision: row.revision,
    updatedAt: new Date(row.updated_at).getTime() } : null;
}

export async function changePickup({ orderId, slotKey, actor }) {
  if (!['ADMIN', 'CUSTOMER'].includes(actor)) throw conflict('Acceso no autorizado.');
  return inventoryTransaction(async client => {
    const orderRow = (await client.query('SELECT order_snapshot FROM checkout_attempts WHERE order_id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!orderRow) throw Object.assign(new Error('Pedido no encontrado.'), { status: 404 });
    const order = orderRow.order_snapshot;
    if (!pickupEligible(order)) throw conflict('El retiro requiere el pago total confirmado por el vendedor.');
    const existing = (await client.query('SELECT * FROM pickup_appointments WHERE order_id=$1 FOR UPDATE', [orderId])).rows[0];
    const oldKey = existing?.status === 'SCHEDULED' ? existing.slot_key : null;
    if (slotKey === oldKey) return { slotKey: oldKey, status: 'SCHEDULED', revision: existing.revision };
    if (slotKey != null && !pickupSlotKeys(order).includes(slotKey)) throw conflict('El horario de retiro no está disponible para este pedido.');
    if (slotKey == null && !oldKey) return existing ? { slotKey: null, status: 'CANCELLED', revision: existing.revision } : null;
    if (slotKey) {
      await client.query('INSERT INTO pickup_windows(slot_key) VALUES($1) ON CONFLICT DO NOTHING', [slotKey]);
      await client.query('SELECT slot_key FROM pickup_windows WHERE slot_key=$1 FOR UPDATE', [slotKey]);
      const occupied = Number((await client.query(`SELECT count(*)::int AS count FROM pickup_appointments
        WHERE slot_key=$1 AND status='SCHEDULED'`, [slotKey])).rows[0].count);
      if (occupied >= PICKUP_RULES.defaultCapacityPerWindow) throw conflict('Este horario ya está completo. Elegí otro.');
    }
    const row = (await client.query(`INSERT INTO pickup_appointments(order_id,slot_key,status,changed_by)
      VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO UPDATE SET slot_key=EXCLUDED.slot_key,
      status=EXCLUDED.status,changed_by=EXCLUDED.changed_by,revision=pickup_appointments.revision+1,
      updated_at=clock_timestamp() RETURNING *`, [orderId, slotKey, slotKey ? 'SCHEDULED' : 'CANCELLED', actor])).rows[0];
    await queueSellerNotification(client, {
      key: `pickup:${orderId}:${row.revision}`, order,
      type: oldKey ? 'PICKUP_CHANGED' : 'PICKUP_SCHEDULED',
      details: { oldSlot: oldKey, slot: slotKey, actor },
    });
    return { slotKey: row.slot_key, status: row.status, revision: row.revision,
      updatedAt: new Date(row.updated_at).getTime() };
  });
}

export async function listUpcomingPickups() {
  const { rows } = await database().pool.query(`SELECT a.slot_key, a.order_id, c.order_snapshot
    FROM pickup_appointments a JOIN checkout_attempts c ON c.order_id=a.order_id
    WHERE a.status='SCHEDULED' AND split_part(a.slot_key,'|',1) >= $1
    ORDER BY a.slot_key, a.order_id`, [todayLocal()]);
  return rows.map(row => ({ slotKey: row.slot_key, orderId: row.order_id,
    buyer: row.order_snapshot.buyer?.name || '',
    itemNumbers: row.order_snapshot.items?.map(item => item.itemNumber) || [] }));
}
