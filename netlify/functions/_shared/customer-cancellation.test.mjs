import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomerCancelOrderHandler } from '../customer-cancel-order.mjs';
import {
  cancelOrder,
  customerCancellationAllowed,
  customerCancelOrder,
  ORDER_HOLD_MS,
  setInventoryDatabaseClientForTests,
} from './inventory-database.mjs';

const NOW = Date.parse('2026-10-16T14:00:00.000Z');

function order(overrides = {}) {
  return {
    id: 'VM-CANCEL-1',
    createdAt: NOW - 1_000,
    updatedAt: NOW - 1_000,
    status: 'AWAITING_INITIAL_PAYMENT',
    buyer: { name: 'María', phone: '+595', email: 'maria@example.com' },
    items: [{ productId: 'A', itemNumber: 1, title: 'Artículo', quantity: 1,
      saleMode: 'IMMEDIATE', dueNowPYG: 100_000, futureBalancePYG: 0 }],
    totals: { totalPYG: 100_000, dueNowPYG: 100_000, futureBalancePYG: 0 },
    receipt: null,
    payments: [],
    paidAmountPYG: 0,
    remainingBalancePYG: 100_000,
    holdExpiresAt: NOW + ORDER_HOLD_MS,
    reservationState: 'ACTIVE',
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

class FakeCancellationDatabase {
  constructor(snapshot = order(), { committedAt = null, reservationPhase = 'ORDER' } = {}) {
    this.state = {
      now: NOW,
      attempt: {
        order_id: snapshot.id,
        order_snapshot: clone(snapshot),
        committed_at: committedAt,
        expires_at: new Date(NOW + ORDER_HOLD_MS),
        projection_version: 7,
      },
      inventory: new Map([['A', { product_id: 'A', capacity: 1, committed_quantity: committedAt ? 1 : 0 }]]),
      reservations: [{ order_id: snapshot.id, product_id: 'A', quantity: 1,
        phase: reservationPhase, expires_at: new Date(NOW + ORDER_HOLD_MS) }],
      events: [
        { order_id: snapshot.id, event_type: 'ORDER_RESERVATION_EXPIRING', cancelled_at: null, processed_at: null },
        { order_id: snapshot.id, event_type: 'ORDER_RESERVATION_EXPIRED', cancelled_at: null, processed_at: null },
      ],
    };
    this.pool = {
      connect: async () => ({
        query: (sql, values = []) => this.query(sql, values),
        release() {},
      }),
    };
  }

  available(productId) {
    const inventory = this.state.inventory.get(productId);
    const held = this.state.reservations
      .filter(row => row.product_id === productId && ['CART', 'ORDER'].includes(row.phase))
      .reduce((sum, row) => sum + row.quantity, 0);
    return inventory.capacity - inventory.committed_quantity - held;
  }

  pendingEvents() {
    return this.state.events.filter(event => !event.cancelled_at && !event.processed_at);
  }

  async query(sql, values) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized === 'BEGIN') {
      this.beforeTransaction = clone({
        ...this.state,
        inventory: [...this.state.inventory],
      });
      return { rows: [] };
    }
    if (normalized === 'COMMIT') {
      this.beforeTransaction = null;
      return { rows: [] };
    }
    if (normalized === 'ROLLBACK') {
      if (this.beforeTransaction) {
        this.state = {
          ...this.beforeTransaction,
          inventory: new Map(this.beforeTransaction.inventory),
        };
      }
      this.beforeTransaction = null;
      return { rows: [] };
    }
    if (normalized.startsWith('SELECT * FROM checkout_attempts WHERE order_id=$1 FOR UPDATE')) {
      return { rows: this.state.attempt.order_id === values[0] ? [this.state.attempt] : [] };
    }
    if (normalized.startsWith("SELECT * FROM inventory_reservations WHERE order_id=$1 AND phase IN ('ORDER','COMMITTED')")) {
      return { rows: this.state.reservations.filter(row =>
        row.order_id === values[0] && ['ORDER', 'COMMITTED'].includes(row.phase)) };
    }
    if (normalized.startsWith('SELECT * FROM operational_inventory WHERE product_id=$1 FOR UPDATE')) {
      const row = this.state.inventory.get(values[0]);
      return { rows: row ? [row] : [] };
    }
    if (normalized === 'SELECT clock_timestamp() AS now') {
      return { rows: [{ now: new Date(this.state.now) }] };
    }
    if (normalized.startsWith("DELETE FROM inventory_reservations WHERE order_id=$1 AND phase='ORDER'")) {
      this.state.reservations = this.state.reservations.filter(row =>
        !(row.order_id === values[0] && row.phase === 'ORDER'));
      return { rows: [] };
    }
    if (normalized.startsWith('UPDATE order_reservation_events SET cancelled_at=clock_timestamp()')) {
      this.state.events.forEach(event => {
        if (event.order_id === values[0] && !event.cancelled_at && !event.processed_at) {
          event.cancelled_at = new Date(this.state.now);
        }
      });
      return { rows: [] };
    }
    if (normalized.startsWith('UPDATE checkout_attempts SET order_snapshot=$2,expires_at=$3')) {
      this.state.attempt.order_snapshot = JSON.parse(values[1]);
      this.state.attempt.expires_at = values[2];
      this.state.attempt.projection_version += 1;
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL in fake cancellation database: ${normalized}`);
  }
}

function installDatabase(snapshot = order(), options) {
  const database = new FakeCancellationDatabase(snapshot, options);
  setInventoryDatabaseClientForTests(database);
  return database;
}

test.afterEach(() => setInventoryDatabaseClientForTests(undefined));

test('customer cancellation accepts only a genuinely untouched awaiting-payment order', () => {
  assert.equal(customerCancellationAllowed(order()), true);
  for (const blocked of [
    order({ status: 'RECEIPT_RECEIVED' }),
    order({ status: 'VERIFYING_PAYMENT' }),
    order({ receipt: { uploadedAt: NOW } }),
    order({ payments: [{ id: 'pending', verificationStatus: 'PENDING' }] }),
    order({ payments: [{ id: 'confirmed', verificationStatus: 'CONFIRMED', amountPYG: 100_000 }] }),
    order({ initialPaymentConfirmedAt: NOW }),
    order({ finalPaymentConfirmedAt: NOW }),
    order({ paidAmountPYG: 100_000 }),
    order({ confirmedPaidPYG: 100_000 }),
    order({ netReceivedPYG: 100_000 }),
    order({ paymentAdjustments: [{ amountPYG: 1 }] }),
  ]) assert.equal(customerCancellationAllowed(blocked), false);
  assert.equal(customerCancellationAllowed(order(), true), false);
});

test('valid private authorization reaches customer cancellation and returns CUSTOMER actor', async () => {
  const authorized = order();
  let cancelledId = null;
  const handler = createCustomerCancelOrderHandler({
    authorizeOrder: async (id, access) => id === authorized.id && access === 'right-token' ? authorized : null,
    cancelAuthorizedOrder: async id => {
      cancelledId = id;
      return order({ status: 'CANCELLED', cancelledBy: 'CUSTOMER', holdExpiresAt: null });
    },
  });
  const response = await handler(new Request('https://example.com/api/orders/cancel', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: authorized.id, access: 'right-token' }),
  }));
  assert.equal(response.status, 200);
  assert.equal(cancelledId, authorized.id);
  const body = await response.json();
  assert.equal(body.order.status, 'CANCELLED');
  assert.equal(body.order.cancelledBy, 'CUSTOMER');
  assert.equal(body.order.holdExpiresAt, null);
});

test('invalid token and wrong token/order pair are rejected without invoking cancellation', async () => {
  let cancellations = 0;
  const handler = createCustomerCancelOrderHandler({
    authorizeOrder: async (id, access) => id === 'VM-CANCEL-1' && access === 'token-for-1' ? order() : null,
    cancelAuthorizedOrder: async () => { cancellations += 1; },
  });
  for (const payload of [
    { orderId: 'VM-CANCEL-1', access: 'invalid' },
    { orderId: 'VM-CANCEL-2', access: 'token-for-1' },
  ]) {
    const response = await handler(new Request('https://example.com/api/orders/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }));
    assert.equal(response.status, 404);
  }
  assert.equal(cancellations, 0);
});

test('customer cancellation endpoint is POST only', async () => {
  const handler = createCustomerCancelOrderHandler();
  const response = await handler(new Request('https://example.com/api/orders/cancel'));
  assert.equal(response.status, 405);
});

test('locked customer cancellation releases inventory, cancels events, clears the hold, and preserves payment data', async () => {
  const originalPayments = [];
  const database = installDatabase(order({ payments: originalPayments }));
  assert.equal(database.available('A'), 0);
  const cancelled = await customerCancelOrder('VM-CANCEL-1');
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.cancelledBy, 'CUSTOMER');
  assert.equal(cancelled.cancelledAt, NOW);
  assert.equal(cancelled.inventoryReleasedAt, NOW);
  assert.equal(cancelled.holdExpiresAt, null);
  assert.equal(cancelled.reservationState, null);
  assert.deepEqual(cancelled.payments, originalPayments);
  assert.equal(database.state.reservations.length, 0);
  assert.equal(database.available('A'), 1);
  assert.equal(database.pendingEvents().length, 0);
  assert.equal(database.state.attempt.projection_version, 8);
});

test('stale eligible UI cannot cancel after receipt activity begins under the order lock', async () => {
  const database = installDatabase(order({ status: 'RECEIPT_RECEIVED',
    receipt: { uploadedAt: NOW }, payments: [{ id: 'pending', verificationStatus: 'PENDING' }] }));
  const handler = createCustomerCancelOrderHandler({
    authorizeOrder: async () => order(),
    cancelAuthorizedOrder: customerCancelOrder,
  });
  const response = await handler(new Request('https://example.com/api/orders/cancel', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: 'VM-CANCEL-1', access: 'stale-valid-token' }),
  }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Contactanos por WhatsApp/);
  assert.equal(database.state.attempt.order_snapshot.status, 'RECEIPT_RECEIVED');
  assert.equal(database.state.reservations.length, 1);
});

test('customer cancellation rejects every durable payment or inventory-commit signal', async () => {
  const cases = [
    [order({ status: 'VERIFYING_PAYMENT' }), {}],
    [order({ initialPaymentConfirmedAt: NOW }), {}],
    [order({ payments: [{ id: 'confirmed', verificationStatus: 'CONFIRMED', amountPYG: 100_000 }] }), {}],
    [order(), { committedAt: new Date(NOW), reservationPhase: 'COMMITTED' }],
    [order(), { reservationPhase: 'COMMITTED' }],
  ];
  for (const [snapshot, options] of cases) {
    const database = installDatabase(snapshot, options);
    await assert.rejects(customerCancelOrder(snapshot.id), /Contactanos por WhatsApp/);
    assert.equal(database.state.attempt.order_snapshot.status, snapshot.status);
    assert.equal(database.state.reservations.length, 1);
  }
});

test('already-cancelled customer request is idempotent and does not rewrite actor or version', async () => {
  const database = installDatabase(order({ status: 'CANCELLED', cancelledBy: 'CUSTOMER', holdExpiresAt: null }));
  const result = await customerCancelOrder('VM-CANCEL-1');
  assert.equal(result.cancelledBy, 'CUSTOMER');
  assert.equal(database.state.attempt.projection_version, 7);
});

test('admin cancellation keeps its broader receipt and verification policy and records ADMIN', async () => {
  for (const status of ['AWAITING_INITIAL_PAYMENT', 'RECEIPT_RECEIVED', 'VERIFYING_PAYMENT']) {
    const snapshot = order({ status, receipt: status === 'AWAITING_INITIAL_PAYMENT' ? null : { uploadedAt: NOW },
      payments: status === 'AWAITING_INITIAL_PAYMENT' ? [] : [{ id: 'pending', verificationStatus: 'PENDING' }] });
    installDatabase(snapshot);
    const cancelled = await cancelOrder(snapshot.id);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.cancelledBy, 'ADMIN');
    assert.equal(cancelled.reservationState, snapshot.reservationState);
  }
});

test('ORDER_HOLD_MS remains the separate two-hour order reservation', () => {
  assert.equal(ORDER_HOLD_MS, 2 * 60 * 60 * 1000);
});
