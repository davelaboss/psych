import { createHash, randomUUID } from 'node:crypto';
import { database, inventoryTransaction } from './inventory-database.mjs';
import { PICKUP_RULES } from './commerce.mjs';
import { orderFulfillmentPart } from './order-fulfillments.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function pickupBaseRanges(day) {
  if (day < PICKUP_RULES.mainPickup.startDate || day > PICKUP_RULES.delayedPickup.endDate) return [];
  return PICKUP_RULES.exceptions[day] || PICKUP_RULES.mainPickup[weekdays[new Date(`${day}T12:00:00Z`).getUTCDay()]] || [];
}
export function validPickupDate(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
}
export function blackoutInput(body) {
  const date = body.date;
  const start = body.allDay === true ? '00:00' : body.start;
  const end = body.allDay === true ? '24:00' : body.end;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!validPickupDate(date) || !time.test(start) || !(time.test(end) || end === '24:00') || start >= end) {
    throw fail('Indicá una fecha válida y un rango de horas de inicio a fin.');
  }
  const reason = body.reason ?? '';
  if (typeof reason !== 'string' || reason.length > 500) throw fail('El motivo admite hasta 500 caracteres.');
  if (body.id != null && !/^[a-f0-9-]{36}$/i.test(body.id)) throw fail('Bloqueo inválido.');
  return { id: body.id || null, date, start, end, reason: reason.trim(), revision: body.revision ?? null };
}
const blockJson = row => ({ id: row.id, date: String(row.day), start: row.start, end: row.end,
  reason: row.reason, revision: row.revision });
const blockSelect = `SELECT id,to_char(pickup_date,'YYYY-MM-DD') AS day,
  left(start_time::text,5) AS start,left(end_time::text,5) AS end,reason,revision FROM pickup_blackouts`;

export function calendarAppointment(row) {
  const part = orderFulfillmentPart(row.order_snapshot, row.timing_key);
  return { slotKey: row.slot_key, orderId: row.order_id, timingKey: row.timing_key, revision: row.revision,
    buyer: row.order_snapshot.buyer?.name || '', buyerPhone: row.order_snapshot.buyer?.phone || '',
    itemNumbers: (part?.items || row.order_snapshot.items || []).map(item => item.itemNumber),
    needsReschedule: Boolean(row.needs_reschedule) };
}
const appointmentSelect = `SELECT a.*,c.order_snapshot,EXISTS(SELECT 1 FROM pickup_blackouts b
  WHERE b.pickup_date=split_part(a.slot_key,'|',1)::date
    AND b.start_time<split_part(split_part(a.slot_key,'|',2),'-',2)::time
    AND b.end_time>split_part(split_part(a.slot_key,'|',2),'-',1)::time) AS needs_reschedule
  FROM pickup_appointments a JOIN checkout_attempts c ON c.order_id=a.order_id
  WHERE a.status='SCHEDULED'`;

export async function readPickupCalendar(month, client = database().pool) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw fail('Mes inválido.');
  const start = `${month}-01`;
  const next = new Date(`${start}T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  const end = next.toISOString().slice(0, 10);
  // One snapshot: counts, warnings and reasons correspond to the same committed state.
  return inventoryRead(client, async tx => {
    const blocks = (await tx.query(`${blockSelect} WHERE pickup_date>=$1::date AND pickup_date<$2::date ORDER BY pickup_date,start_time,id`, [start, end])).rows.map(blockJson);
    const appointments = (await tx.query(`${appointmentSelect} AND split_part(a.slot_key,'|',1)>=$1
      AND split_part(a.slot_key,'|',1)<$2 ORDER BY a.slot_key,a.order_id,a.timing_key`, [start, end])).rows.map(calendarAppointment);
    const days = [];
    for (let day = start; day < end;) {
      days.push({ date: day, ranges: pickupBaseRanges(day) });
      day = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    }
    return { month, timezone: PICKUP_RULES.timezone, days, blocks, appointments };
  });
}
// A pool must use a single client for a consistent read transaction; tests can pass a client.
async function inventoryRead(pool, operation) {
  if (!pool.connect) return operation(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await operation(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function changePickupBlackout(body, { transaction = inventoryTransaction } = {}) {
  const action = body.action;
  if (!['preview', 'save', 'remove'].includes(action)) throw fail('Acción inválida.');
  const candidate = blackoutInput(body);
  return transaction(async client => {
    // Serialize blackout edits before locking old/new dates. Booking only needs the date locks.
    await client.query("INSERT INTO pickup_windows(slot_key) VALUES('blackout-management') ON CONFLICT DO NOTHING");
    await client.query("SELECT slot_key FROM pickup_windows WHERE slot_key='blackout-management' FOR UPDATE");
    const previous = candidate.id ? (await client.query(`${blockSelect} WHERE id=$1`, [candidate.id])).rows[0] : null;
    if (candidate.id && !previous) throw fail('Este bloqueo ya no existe. Actualizá el calendario.', 409);
    if (previous && previous.revision !== candidate.revision) throw fail('Este bloqueo cambió. Actualizá el calendario antes de editarlo.', 409);
    for (const day of [...new Set([candidate.date, previous?.day].filter(Boolean))].sort()) {
      await client.query('INSERT INTO pickup_windows(slot_key) VALUES($1) ON CONFLICT DO NOTHING', [day]);
      await client.query('SELECT slot_key FROM pickup_windows WHERE slot_key=$1 FOR UPDATE', [day]);
    }
    if (action === 'remove') {
      if (!previous) throw fail('Falta el bloqueo.');
      await client.query('DELETE FROM pickup_blackouts WHERE id=$1', [candidate.id]);
      return { saved: true };
    }
    const conflicts = (await client.query(`${appointmentSelect} AND split_part(a.slot_key,'|',1)=$1
      AND split_part(split_part(a.slot_key,'|',2),'-',1)::time<$3::time
      AND split_part(split_part(a.slot_key,'|',2),'-',2)::time>$2::time
      ORDER BY a.slot_key,a.order_id,a.timing_key`, [candidate.date, candidate.start, candidate.end])).rows.map(calendarAppointment);
    // Bind confirmation to the exact candidate and actual appointment revisions/contact details.
    // Any intervening booking or reschedule requires another review under the shared date lock.
    const reviewToken = createHash('sha256').update(JSON.stringify({ candidate, conflicts })).digest('hex');
    if (action === 'preview' || body.reviewToken !== reviewToken) return { saved: false, conflicts, reviewToken };
    const id = candidate.id || randomUUID();
    await client.query(`INSERT INTO pickup_blackouts(id,pickup_date,start_time,end_time,reason)
      VALUES($1,$2::date,$3::time,$4::time,$5) ON CONFLICT(id) DO UPDATE SET
      pickup_date=EXCLUDED.pickup_date,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,
      reason=EXCLUDED.reason,revision=pickup_blackouts.revision+1,updated_at=clock_timestamp()`,
    [id, candidate.date, candidate.start, candidate.end, candidate.reason]);
    return { saved: true, id };
  });
}
