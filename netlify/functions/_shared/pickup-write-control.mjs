import { database, inventoryTransaction } from './inventory-database.mjs';

export const PICKUP_PAUSED_MESSAGE = 'Los cambios de retiros y las decisiones de pago por artículo están pausados temporalmente. Los pedidos y turnos existentes se conservan.';
const unavailable = () => Object.assign(new Error(PICKUP_PAUSED_MESSAGE), { status: 503 });
const conflict = message => Object.assign(new Error(message), { status: 409 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function state(client, lock = '') {
  try {
    const row = (await client.query(`SELECT * FROM pickup_write_control WHERE singleton=true ${lock}`)).rows[0];
    if (!row || typeof row.paused !== 'boolean' || !Number.isInteger(row.revision)) throw unavailable();
    return row;
  } catch { throw unavailable(); }
}

// Must be the FIRST lock in the mutation's transaction, held through COMMIT.
// A confirmed pause has drained all earlier guarded writers. No cached flag.
export async function requirePickupWrites(client = database().pool, { lock = false } = {}) {
  const current = await state(client, lock ? 'FOR SHARE' : '');
  if (current.paused) throw unavailable();
}
export async function pickupWritesPaused() {
  try { return (await state(database().pool)).paused; } catch { return true; }
}
export async function readPickupWriteControl() {
  // One statement gives state + recent evidence from the same MVCC snapshot.
  try {
    const row = (await database().pool.query(`SELECT c.*, (SELECT jsonb_agg(e ORDER BY e.revision DESC)
      FROM (SELECT * FROM pickup_write_control_events ORDER BY revision DESC LIMIT 10) e) AS events
      FROM pickup_write_control c WHERE singleton=true`)).rows[0];
    if (!row) throw unavailable();
    return row;
  } catch { throw unavailable(); }
}
export async function setPickupWriteControl(input, dependencies = {}) {
  const { id, paused, expectedRevision } = input;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (typeof id !== 'string' || !uuid.test(id) || typeof paused !== 'boolean' ||
      !Number.isInteger(expectedRevision) || expectedRevision < 1 || !reason || reason.length > 1000) {
    throw Object.assign(new Error('Ingresá una revisión válida, identificador y motivo de hasta 1.000 caracteres.'), { status: 400 });
  }
  try {
    return await (dependencies.transaction || inventoryTransaction)(async client => {
      // Bound acknowledgement latency. A timeout is NEVER a confirmed pause.
      await client.query("SET LOCAL lock_timeout='5s'");
      const current = (await client.query('SELECT * FROM pickup_write_control WHERE singleton=true FOR UPDATE')).rows[0];
      if (!current) throw unavailable();
      const previous = (await client.query('SELECT * FROM pickup_write_control_events WHERE id=$1', [id])).rows[0];
      if (previous) {
        if (previous.paused !== paused || previous.previous_revision !== expectedRevision || previous.reason !== reason) {
          throw conflict('El identificador ya corresponde a otra decisión.');
        }
        return { state: current, event: previous, replayed: true };
      }
      if (current.revision !== expectedRevision) throw conflict('El estado cambió. Actualizá antes de continuar.');
      const event = (await client.query(`INSERT INTO pickup_write_control_events
        (id,revision,previous_revision,paused,actor,reason) VALUES($1,$2,$3,$4,'ADMIN',$5) RETURNING *`,
        [id, current.revision + 1, current.revision, paused, reason])).rows[0];
      const updated = (await client.query(`UPDATE pickup_write_control SET paused=$1,revision=$2,changed_at=clock_timestamp()
        WHERE singleton=true RETURNING *`, [paused, event.revision])).rows[0];
      return { state: updated, event, replayed: false };
    });
  } catch (error) {
    if (error.code === '55P03') throw conflict('No se confirmó el cambio: hay operaciones en curso. Actualizá y volvé a intentar.');
    if (error.status) throw error;
    throw unavailable();
  }
}
