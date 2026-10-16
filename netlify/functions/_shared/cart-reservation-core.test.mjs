import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCartReservationHandler } from '../cart-reservation.mjs';
import {
  CART_HOLD_MS,
  ORDER_HOLD_MS,
  claimCartLease,
  getCartLeaseStatus,
  setInventoryDatabaseClientForTests,
  updateCartLease,
} from './inventory-database.mjs';

const HOUR = 60 * 60 * 1000;
const sessionA = '11111111-1111-4111-8111-111111111111';
const sessionB = '22222222-2222-4222-8222-222222222222';

function copyState(state) {
  return structuredClone(state);
}

class FakeInventoryDatabase {
  constructor(now = Date.parse('2026-10-16T14:00:00.000Z')) {
    this.state = { now, sessions: new Map(), inventory: new Map(), reservations: [] };
    this.pool = {
      connect: async () => ({
        query: (sql, values = []) => this.query(sql, values),
        release() {},
      }),
    };
  }

  advance(milliseconds) {
    this.state.now += milliseconds;
  }

  rows(sessionId) {
    return this.state.reservations.filter((row) => row.session_id === sessionId && row.phase === 'CART');
  }

  async query(sql, values) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized === 'BEGIN') {
      this.beforeTransaction = copyState(this.state);
      return { rows: [] };
    }
    if (normalized === 'COMMIT') {
      this.beforeTransaction = null;
      return { rows: [] };
    }
    if (normalized === 'ROLLBACK') {
      if (this.beforeTransaction) this.state = this.beforeTransaction;
      this.beforeTransaction = null;
      return { rows: [] };
    }
    if (normalized.startsWith('INSERT INTO cart_sessions')) {
      if (!this.state.sessions.has(values[0])) {
        this.state.sessions.set(values[0], {
          session_id: values[0], generation: 0, created_at: null, expires_at: null,
          expired_at: null, extension_used_at: null,
        });
      }
      return { rows: [] };
    }
    if (normalized.startsWith('SELECT * FROM cart_sessions')) {
      return { rows: [structuredClone(this.state.sessions.get(values[0]))] };
    }
    if (normalized.startsWith("SELECT * FROM inventory_reservations WHERE session_id=$1 AND phase='CART'")) {
      return { rows: this.rows(values[0]).sort((a, b) => a.product_id.localeCompare(b.product_id)) };
    }
    if (normalized.startsWith('INSERT INTO operational_inventory')) {
      if (!this.state.inventory.has(values[0])) {
        this.state.inventory.set(values[0], { product_id: values[0], capacity: values[1], committed_quantity: 0 });
      }
      return { rows: [] };
    }
    if (normalized.startsWith('SELECT * FROM operational_inventory')) {
      const row = this.state.inventory.get(values[0]);
      return { rows: row ? [row] : [] };
    }
    if (normalized === 'SELECT clock_timestamp() AS now') {
      return { rows: [{ now: new Date(this.state.now) }] };
    }
    if (normalized.startsWith("DELETE FROM inventory_reservations WHERE session_id=$1 AND phase='CART'")) {
      this.state.reservations = this.state.reservations.filter((row) => !(row.session_id === values[0] && row.phase === 'CART'));
      return { rows: [] };
    }
    if (normalized.startsWith("DELETE FROM inventory_reservations WHERE session_id=$1 AND product_id=$2 AND phase='CART'")) {
      this.state.reservations = this.state.reservations.filter((row) => !(row.session_id === values[0] && row.product_id === values[1] && row.phase === 'CART'));
      return { rows: [] };
    }
    if (normalized.startsWith('UPDATE cart_sessions SET expired_at=expires_at,expires_at=NULL')) {
      const session = this.state.sessions.get(values[0]);
      session.expired_at = session.expires_at;
      session.expires_at = null;
      return { rows: [] };
    }
    if (normalized.startsWith('SELECT p.capacity-p.committed_quantity-COALESCE')) {
      const inventory = this.state.inventory.get(values[0]);
      const blocked = this.state.reservations
        .filter((row) => row.product_id === values[0] && (
          (row.phase === 'CART' && Number(row.expires_at) > this.state.now && row.session_id !== values[1]) ||
          (row.phase === 'ORDER' && (!row.expires_at || Number(row.expires_at) > this.state.now))
        ))
        .reduce((sum, row) => sum + row.quantity, 0);
      return { rows: inventory ? [{ available: inventory.capacity - inventory.committed_quantity - blocked }] : [] };
    }
    if (normalized.startsWith('UPDATE cart_sessions SET generation=generation+1,created_at=$2')) {
      const session = this.state.sessions.get(values[0]);
      session.generation += 1;
      session.created_at = values[1];
      session.expired_at = null;
      session.extension_used_at = null;
      return { rows: [] };
    }
    if (normalized.startsWith('INSERT INTO inventory_reservations')) {
      let row = this.state.reservations.find((candidate) => candidate.session_id === values[1] && candidate.product_id === values[0] && candidate.phase === 'CART');
      if (row) row.quantity = values[2];
      else {
        row = { product_id: values[0], session_id: values[1], quantity: values[2], phase: 'CART', expires_at: values[3] };
        this.state.reservations.push(row);
      }
      return { rows: [] };
    }
    if (normalized.startsWith('UPDATE cart_sessions SET expires_at=NULL')) {
      this.state.sessions.get(values[0]).expires_at = null;
      return { rows: [] };
    }
    if (normalized.startsWith('UPDATE cart_sessions SET expires_at=$2')) {
      this.state.sessions.get(values[0]).expires_at = values[1];
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE inventory_reservations SET expires_at=$2") && normalized.includes("phase='CART'")) {
      this.rows(values[0]).forEach((row) => { row.expires_at = values[1]; });
      return { rows: [] };
    }
    if (normalized.startsWith('SELECT a.order_id FROM checkout_attempts')) return { rows: [] };
    throw new Error(`Unexpected SQL in fake database: ${normalized}`);
  }
}

function installDatabase(now) {
  const database = new FakeInventoryDatabase(now);
  setInventoryDatabaseClientForTests(database);
  return database;
}

test.afterEach(() => setInventoryDatabaseClientForTests(undefined));

test('first claim and later new item claims reset one shared cart deadline to server now plus two hours', async () => {
  const database = installDatabase();
  const firstNow = database.state.now;
  const first = await claimCartLease({ cartSessionId: sessionA, productId: 'A', quantity: 1, availability: 1 });
  assert.equal(first.expiresAt, firstNow + CART_HOLD_MS);

  database.advance(30 * 60 * 1000);
  const secondNow = database.state.now;
  const second = await claimCartLease({ cartSessionId: sessionA, productId: 'B', quantity: 1, availability: 1 });
  assert.equal(second.expiresAt, secondNow + CART_HOLD_MS);
  assert.deepEqual(second.items, { A: 1, B: 1 });
  assert.deepEqual(new Set(database.rows(sessionA).map((row) => Number(row.expires_at))), new Set([second.expiresAt]));
});

test('quantity increase resets the whole cart while decrease and no-op preserve the exact deadline', async () => {
  const database = installDatabase();
  await claimCartLease({ cartSessionId: sessionA, productId: 'A', quantity: 1, availability: 4 });
  await claimCartLease({ cartSessionId: sessionA, productId: 'B', quantity: 1, availability: 1 });
  const initial = Number(database.state.sessions.get(sessionA).expires_at);

  database.advance(10 * 60 * 1000);
  const increased = await updateCartLease({ cartSessionId: sessionA, productId: 'A', quantity: 2, availability: 4 });
  assert.equal(increased.lease.expiresAt, database.state.now + CART_HOLD_MS);
  assert.deepEqual(new Set(database.rows(sessionA).map((row) => Number(row.expires_at))), new Set([increased.lease.expiresAt]));
  assert.ok(increased.lease.expiresAt > initial);

  database.advance(10 * 60 * 1000);
  const decreased = await updateCartLease({ cartSessionId: sessionA, productId: 'A', quantity: 1, availability: 4 });
  assert.equal(decreased.lease.expiresAt, increased.lease.expiresAt);
  database.advance(10 * 60 * 1000);
  const unchanged = await updateCartLease({ cartSessionId: sessionA, productId: 'A', quantity: 1, availability: 4 });
  assert.equal(unchanged.lease.expiresAt, increased.lease.expiresAt);
});

test('failed new-item and failed quantity-increase claims roll back without rewarding the cart', async () => {
  const database = installDatabase();
  await claimCartLease({ cartSessionId: sessionA, productId: 'A', quantity: 1, availability: 1 });
  const original = Number(database.state.sessions.get(sessionA).expires_at);
  database.advance(20 * 60 * 1000);

  await assert.rejects(
    claimCartLease({ cartSessionId: sessionA, productId: 'B', quantity: 1, availability: 0 }),
    /reservado por otro comprador/
  );
  assert.equal(Number(database.state.sessions.get(sessionA).expires_at), original);
  assert.deepEqual(database.rows(sessionA).map((row) => row.product_id), ['A']);

  await assert.rejects(
    updateCartLease({ cartSessionId: sessionA, productId: 'A', quantity: 2, availability: 1 }),
    /reservado por otro comprador/
  );
  assert.equal(Number(database.state.sessions.get(sessionA).expires_at), original);
  assert.equal(database.rows(sessionA)[0].quantity, 1);
});

test('status reads are passive, expiration releases inventory, and sessions remain isolated', async () => {
  const database = installDatabase();
  const leaseA = await claimCartLease({ cartSessionId: sessionA, productId: 'A', quantity: 1, availability: 2 });
  database.advance(10 * 60 * 1000);
  const status = await getCartLeaseStatus(sessionA);
  assert.equal(status.lease.expiresAt, leaseA.expiresAt);

  const leaseB = await claimCartLease({ cartSessionId: sessionB, productId: 'A', quantity: 1, availability: 2 });
  assert.notEqual(leaseB.expiresAt, leaseA.expiresAt);
  assert.equal(database.rows(sessionA).length, 1);
  assert.equal(database.rows(sessionB).length, 1);

  database.advance(CART_HOLD_MS);
  const expired = await getCartLeaseStatus(sessionA);
  assert.equal(expired.lease, null);
  assert.equal(expired.expiredAt, leaseA.expiresAt);
  assert.equal(database.rows(sessionA).length, 0);

  const reclaimed = await claimCartLease({ cartSessionId: sessionA, productId: 'A', quantity: 1, availability: 2 });
  assert.equal(reclaimed.items.A, 1);
  assert.equal(database.rows(sessionB).length, 1);
});

test('public extend action is rejected and never invokes a lease mutation', async () => {
  let mutated = false;
  const handler = createCartReservationHandler({
    claimLease: async () => { mutated = true; },
    updateLease: async () => { mutated = true; },
    releaseLease: async () => { mutated = true; },
  });
  const response = await handler(new Request('https://example.com/api/cart/reservation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `psych_cart_session=${sessionA}` },
    body: JSON.stringify({ action: 'extend' }),
  }));
  assert.equal(response.status, 400);
  assert.equal(mutated, false);
  assert.match((await response.json()).error, /no admite extensiones/);
});

test('cart and order holds remain distinct two-hour phases and order transition semantics are unchanged', async () => {
  assert.equal(CART_HOLD_MS, 2 * HOUR);
  assert.equal(ORDER_HOLD_MS, 2 * HOUR);
  const source = await readFile(new URL('./inventory-database.mjs', import.meta.url), 'utf8');
  const transition = source.slice(
    source.indexOf('export async function transitionCartLeaseToOrder'),
    source.indexOf('export async function getOrderSnapshot')
  );
  assert.match(transition, /new Date\(timestamp \+ ORDER_HOLD_MS\)/);
  assert.match(transition, /SET phase='ORDER',order_id=\$2,expires_at=\$3/);
  assert.match(transition, /UPDATE cart_sessions SET expires_at=NULL,expired_at=NULL/);
  assert.doesNotMatch(transition, /CART_HOLD_MS/);
});
