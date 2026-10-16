import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enqueueDueOrderReservationNotifications } from './order-reservation-notifications.mjs';

function fixture(email) {
  const expiresAt = new Date('2026-10-16T15:00:00Z');
  const event = {
    event_id: 'reservation-event',
    order_id: 'VM-RESERVATION',
    event_type: 'ORDER_RESERVATION_EXPIRING',
    reservation_expires_at: expiresAt,
  };
  const order = {
    id: event.order_id,
    buyer: { name: 'María', phone: '+595 981 000000', email },
    status: 'AWAITING_INITIAL_PAYMENT',
    holdExpiresAt: expiresAt.getTime(),
    items: [{ saleMode: 'IMMEDIATE' }],
  };
  const inserted = [];
  let processed = false;
  const client = { async query(sql, params = []) {
    if (sql.includes('FROM order_reservation_events')) return { rows: [event] };
    if (sql.includes('SELECT * FROM checkout_attempts') && sql.includes('FOR UPDATE')) {
      return { rows: [{ expires_at: expiresAt, committed_at: null, order_snapshot: order }] };
    }
    if (sql.includes('SELECT session_id FROM checkout_attempts')) {
      return { rows: [{ session_id: 'cart-session' }] };
    }
    if (sql.includes('INSERT INTO seller_notifications')) {
      inserted.push({ eventKey: params[0], eventType: params[2], role: params[4], email: params[5] });
      return { rows: [] };
    }
    if (sql.includes('UPDATE order_reservation_events SET processed_at')) {
      processed = true;
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return { client, inserted, wasProcessed: () => processed };
}

const dependencies = client => ({
  transaction: callback => callback(client),
  now: () => Date.parse('2026-10-16T14:30:00Z'),
});

test('scheduled reservation event with emailed buyer queues zero rows and is still processed', async () => {
  const state = fixture('maria@example.com');
  await enqueueDueOrderReservationNotifications(1, dependencies(state.client));
  assert.deepEqual(state.inserted, []);
  assert.equal(state.wasProcessed(), true);
});

test('same scheduled reservation event queues a seller row for a buyer without email', async () => {
  const state = fixture('   ');
  await enqueueDueOrderReservationNotifications(1, dependencies(state.client));
  assert.deepEqual(state.inserted, [{
    eventKey: 'reservation:reservation-event:seller',
    eventType: 'ORDER_RESERVATION_EXPIRING',
    role: 'SELLER',
    email: null,
  }]);
  assert.equal(state.wasProcessed(), true);
});
