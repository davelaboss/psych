import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setPickupWriteControl } from '../pickup-write-control.mjs';
// Test fixtures explicitly open the production migration's paused default.
export async function initializePickupControlForTests(db) {
  const sql = await readFile(new URL('../../../database/migrations/20261115_pickup_containment.sql', import.meta.url), 'utf8');
  if (db.exec) await db.exec(sql); else await db.query(sql);
  await setPickupWriteControl({ id: randomUUID(), paused: false, expectedRevision: 1, reason: 'Isolated test fixture' }, {
    transaction: async operation => {
      const client = db.connect ? await db.connect() : db;
      try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { if (db.connect) client.release(); }
    }
  });
}
