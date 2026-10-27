import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  claimCartLease, getCartLeaseStatus, transitionCartLeaseToOrder, recordOrderReceipt,
  confirmOrderPayment, cancelOrder, refreshOrderReservation, setInventoryDatabaseClientForTests,
} from './inventory-database.mjs';
import { changePickup, pickupAvailability, pickupFulfillments, listUpcomingPickups } from './pickup.mjs';
import { attachOrderReceipt } from './receipt-upload.mjs';
import { enqueueDueOrderReservationNotifications } from './order-reservation-notifications.mjs';
import {
  customerNotification, notificationLinks, queueOrderNotifications,
  drainSellerNotifications, dispatchSellerNotificationsSafely,
} from './seller-notifications.mjs';

// All business and claim SQL runs against in-memory PostgreSQL with real schema
// constraints. No external database, blob storage, or mail provider is contacted.
let db;
let query;
const originalFetch = globalThis.fetch;
const envKeys = ['SELLER_NOTIFICATION_TO', 'SELLER_NOTIFICATION_FROM', 'RESEND_API_KEY',
  'URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const slots = ['2026-12-09|08:00-12:00', '2026-12-10|08:00-12:00'];
const authorizedTypes = ['ORDER_CREATED', 'RECEIPT_UPLOADED', 'FINAL_RECEIPT_UPLOADED',
  'PAYMENT_CONFIRMED', 'PICKUP_SCHEDULED', 'PICKUP_CHANGED'];

test.before(async () => {
  db = new PGlite();
  for (const migration of ['20261001_operational_inventory', '20261002_cart_extension',
    '20261004_order_reservation_events', '20261005_pickup_notifications',
    '20261006_notification_recipients', '20261010_pickup_fulfillment_parts']) {
    await db.exec(await readFile(new URL(`../../database/migrations/${migration}.sql`, import.meta.url), 'utf8'));
  }
});

test.beforeEach(async () => {
  await db.exec('TRUNCATE cart_sessions,operational_inventory RESTART IDENTITY CASCADE');
  query = (sql, params = []) => db.query(sql, params);
  setInventoryDatabaseClientForTests({ pool: {
    query: (sql, params) => query(sql, params),
    connect: async () => ({ query: (sql, params) => query(sql, params), release() {} }),
  } });
  process.env.SELLER_NOTIFICATION_TO = 'seller@example.com';
  process.env.SELLER_NOTIFICATION_FROM = 'Sale <sale@example.com>';
  process.env.RESEND_API_KEY = 'mock-provider-key';
  process.env.DEPLOY_PRIME_URL = 'https://example.com';
  globalThis.fetch = async () => { throw new Error('Unexpected network request in isolated test'); };
});

test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(async () => {
  setInventoryDatabaseClientForTests(undefined);
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  await db?.close();
});

const rows = async (sql = 'SELECT * FROM seller_notifications ORDER BY created_at,event_key', params = []) =>
  (await db.query(sql, params)).rows;

async function cart(email = 'buyer@example.com', delayed = false) {
  const cartSessionId = randomUUID();
  const productId = randomUUID();
  const orderId = `VM-TEST-${randomUUID()}`;
  const item = { productId, quantity: 1, saleMode: delayed ? 'DELAYED' : 'IMMEDIATE',
    title: 'Synthetic test item', unitPricePYG: 100_000,
    dueNowPYG: delayed ? 25_000 : 100_000, futureBalancePYG: delayed ? 75_000 : 0 };
  await claimCartLease({ cartSessionId, productId, quantity: 1, availability: 1 });
  return { cartSessionId, checkoutId: randomUUID(), orderId, items: [{ productId, quantity: 1 }],
    availability: { [productId]: 1 }, orderSnapshot: {
      id: orderId, buyer: { name: 'María', phone: '+595 000000', email },
      status: 'AWAITING_INITIAL_PAYMENT', items: [item], payments: [], paymentAdjustments: [],
      totals: { totalPYG: 100_000, dueNowPYG: item.dueNowPYG, futureBalancePYG: item.futureBalancePYG },
    } };
}

async function created(email, delayed) {
  const args = await cart(email, delayed);
  const result = await transitionCartLeaseToOrder(args);
  return { args, order: result.orderSnapshot };
}

const receipt = () => ({ storageKey: `synthetic/${randomUUID()}`, fileName: 'synthetic.pdf',
  contentType: 'application/pdf', uploadedAt: Date.now(), uploadedBy: 'CUSTOMER' });

async function pay(orderId, amount, type = 'FULL', extra = {}) {
  const accepted = await recordOrderReceipt(orderId, receipt());
  const paymentId = accepted.payments.at(-1).id;
  const confirmation = { paymentId, paymentType: type, verifiedAmountPYG: amount, ...extra };
  return { confirmation, order: await confirmOrderPayment(orderId, confirmation) };
}

function mockProvider(status = 200) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    calls.push({ ...JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
    return new Response(JSON.stringify({ id: 'mock-mail-id' }), { status });
  };
  return calls;
}

test('cart activity, incomplete checkout and rejected order creation enqueue nothing', async () => {
  const args = await cart();
  await getCartLeaseStatus(args.cartSessionId);
  assert.deepEqual(await rows(), []);
  await assert.rejects(transitionCartLeaseToOrder({ ...args, items: [] }), /selección del carrito cambió/);
  assert.deepEqual(await rows(), []);
  assert.deepEqual(await rows('SELECT * FROM checkout_attempts'), []);
  assert.equal((await rows('SELECT phase FROM inventory_reservations'))[0].phase, 'CART');
});

test('successful creation and retries create exactly one seller row for each buyer-email case', async () => {
  for (const email of ['buyer@example.com', '', '   ', null]) {
    const { args, order } = await created(email);
    await transitionCartLeaseToOrder(args);
    const notifications = await rows('SELECT * FROM seller_notifications WHERE order_id=$1', [order.id]);
    assert.equal(notifications.length, 1);
    const [row] = notifications;
    assert.equal(row.recipient_role, 'SELLER');
    assert.equal(row.recipient_email, null);
    assert.equal(row.event_key, `order:${order.id}:seller`);
    const expected = customerNotification({ order, type: 'ORDER_CREATED',
      ...notificationLinks(order.id, args.cartSessionId) });
    assert.equal(row.subject, expected.subject);
    assert.equal(row.message, expected.text);
  }
});

test('enqueue failure rolls back new order and preserves the cart reservation', async () => {
  const args = await cart();
  query = (sql, params = []) => {
    if (sql.includes('INSERT INTO seller_notifications')) throw new Error('Synthetic enqueue failure');
    return db.query(sql, params);
  };
  await assert.rejects(transitionCartLeaseToOrder(args), /Synthetic enqueue failure/);
  assert.deepEqual(await rows(), []);
  assert.deepEqual(await rows('SELECT * FROM checkout_attempts'), []);
  assert.equal((await rows('SELECT phase FROM inventory_reservations'))[0].phase, 'CART');
});

test('accepted initial/final receipts enqueue once; duplicate pending, rejected and invalid uploads do not', async () => {
  const { order } = await created('buyer@example.com', true);
  const initial = await recordOrderReceipt(order.id, receipt());
  assert.equal(await recordOrderReceipt(order.id, receipt()), false);
  await assert.rejects(attachOrderReceipt({ orderId: order.id,
    file: new File(['invalid'], 'invalid.txt', { type: 'text/plain' }), uploadedBy: 'CUSTOMER' }), /JPEG/);
  assert.equal(await recordOrderReceipt('VM-MISSING', receipt()), false);
  await confirmOrderPayment(order.id, { paymentId: initial.payments.at(-1).id,
    paymentType: 'DEPOSIT', verifiedAmountPYG: 25_000 });
  const final = await recordOrderReceipt(order.id, receipt());
  assert.equal(final.status, 'FINAL_RECEIPT_RECEIVED');
  assert.equal(await recordOrderReceipt(order.id, receipt()), false);
  const notices = await rows("SELECT * FROM seller_notifications WHERE event_type LIKE '%RECEIPT_UPLOADED'");
  assert.deepEqual(notices.map(row => row.event_type).sort(), ['FINAL_RECEIPT_UPLOADED', 'RECEIPT_UPLOADED']);
  for (const row of notices) {
    assert.equal(row.recipient_role, 'SELLER');
    assert.match(row.message, /Hola María\./);
    assert.match(row.message, /no confirma el pago automáticamente/);
  }
});

test('payment transactions preserve partial, satisfied-deposit, additional-installment and full-payment wording', async () => {
  const { order } = await created('buyer@example.com', true);
  const steps = [
    [10_000, 'DEPOSIT', { approvePartialPayment: true, internalNote: 'INTERNAL-SECRET-PAYMENT' },
      'PARTIALLY_PAID', 'Pago parcial de seña confirmado', 90_000],
    [15_000, 'FINAL', {}, 'DEPOSIT_SATISFIED', 'Seña confirmada', 75_000],
    [5_000, 'FINAL', {}, 'DEPOSIT_SATISFIED', 'Pago adicional confirmado', 70_000],
    [70_000, 'FINAL', {}, 'FULLY_PAID', 'Pago total confirmado', 0],
  ];
  let total = 0;
  for (const [amount, type, extra, state, subject, remaining] of steps) {
    const result = await pay(order.id, amount, type, extra);
    total += amount;
    const beforeRetry = await rows();
    await confirmOrderPayment(order.id, result.confirmation);
    assert.deepEqual(await rows(), beforeRetry);
    assert.equal(result.order.paymentState, state);
    assert.equal(result.order.paidAmountPYG, total);
    assert.equal(result.order.remainingBalancePYG, remaining);
    const [row] = await rows('SELECT * FROM seller_notifications WHERE event_key=$1',
      [`payment:${result.confirmation.paymentId}:seller`]);
    assert.equal(row.recipient_role, 'SELLER');
    assert.equal(row.subject, `${subject} · ${order.id}`);
    assert.match(row.message, new RegExp(`Pagado confirmado: Gs\\. ${total.toLocaleString('es-PY').replaceAll('.', '\\.')}\\nSaldo pendiente: Gs\\. ${remaining.toLocaleString('es-PY').replaceAll('.', '\\.')}`));
    assert.doesNotMatch(row.message, /INTERNAL-SECRET|administrativ|Acción requerida|David,/);
    if (remaining) assert.doesNotMatch(row.message, /pago total/i);
  }
  assert.equal((await rows('SELECT committed_quantity FROM operational_inventory'))[0].committed_quantity, 1);
  assert.equal((await rows("SELECT * FROM seller_notifications WHERE event_type='PAYMENT_CONFIRMED'")).length, 4);
});

test('failed payment validation commits neither a notification nor a payment change', async () => {
  const { order } = await created();
  const pending = await recordOrderReceipt(order.id, receipt());
  const before = await rows();
  await assert.rejects(confirmOrderPayment(order.id, { paymentId: pending.payments.at(-1).id,
    paymentType: 'FULL', verifiedAmountPYG: 1 }), /aprobar expresamente/);
  assert.deepEqual(await rows(), before);
  assert.equal((await rows('SELECT order_snapshot FROM checkout_attempts'))[0].order_snapshot.payments[0].verificationStatus, 'PENDING');
});

async function scheduledOrder() {
  const { order } = await created();
  await pay(order.id, 100_000);
  const change = slotKey => changePickup({ orderId: order.id, timingKey: 'IMMEDIATE', slotKey,
    actor: 'ADMIN' }, { slotKeys: () => slots });
  return { order, change };
}

test('pickup scheduling/rescheduling enqueue once; unchanged and cancelled appointments enqueue nothing', async () => {
  const { order, change } = await scheduledOrder();
  await change(slots[0]);
  const before = await rows();
  await change(slots[0]);
  assert.deepEqual(await rows(), before);
  await change(slots[1]);
  const beforeCancel = await rows();
  await change(null);
  await change(null);
  assert.deepEqual(await rows(), beforeCancel);
  const [appointment] = await rows('SELECT * FROM pickup_appointments');
  assert.equal(appointment.status, 'CANCELLED');
  assert.equal(appointment.slot_key, null);
  const pickups = await rows("SELECT * FROM seller_notifications WHERE event_type LIKE 'PICKUP_%' ORDER BY created_at");
  assert.deepEqual(pickups.map(row => row.event_type), ['PICKUP_SCHEDULED', 'PICKUP_SCHEDULED',
    'PICKUP_CHANGED', 'PICKUP_CHANGED']);
  for (const row of pickups.filter(row => !row.payload.kind)) {
    assert.equal(row.recipient_role, 'SELLER');
    assert.match(row.message, /Hola María\./);
    assert.match(row.message, /Fecha:\n[0-9]+ de diciembre de 2026\n\nHora:\n08:00 a 12:00/);
    assert.ok(row.message.includes(`/pedido/${order.id}?access=`));
    assert.doesNotMatch(row.message, /canceló|administrativ/);
  }
  assert.ok(pickups.filter(row => row.payload.kind).every(row => row.recipient_role === 'SELLER'
    && row.message === null && row.payload.appointmentRevision > 0));
});

test('order cancellation and reservation expiration keep business behavior without emails', async () => {
  const cancelled = await created();
  const before = await rows();
  await cancelOrder(cancelled.order.id);
  assert.deepEqual(await rows(), before);
  assert.equal((await rows('SELECT * FROM inventory_reservations WHERE order_id=$1', [cancelled.order.id])).length, 0);
  const expired = await created();
  await db.query("UPDATE checkout_attempts SET expires_at=clock_timestamp()-interval '1 minute' WHERE order_id=$1", [expired.order.id]);
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-interval '1 minute' WHERE order_id=$1", [expired.order.id]);
  const expiration = (await rows('SELECT expires_at FROM checkout_attempts WHERE order_id=$1', [expired.order.id]))[0].expires_at;
  await db.query('UPDATE order_reservation_events SET reservation_expires_at=$2,due_at=$2 WHERE order_id=$1', [expired.order.id, expiration]);
  const beforeExpiration = await rows();
  await enqueueDueOrderReservationNotifications();
  assert.deepEqual(await rows(), beforeExpiration);
  assert.equal((await rows('SELECT * FROM order_reservation_events WHERE order_id=$1 AND processed_at IS NOT NULL', [expired.order.id])).length, 2);
  // Another buyer can claim expired stock, as before.
  await claimCartLease({ cartSessionId: randomUUID(), productId: expired.args.items[0].productId,
    quantity: 1, availability: 1 });
  const refresh = await refreshOrderReservation(expired.order.id);
  assert.equal(refresh.available, false);
  assert.equal(refresh.order.status, 'RESERVATION_EXPIRED');
  assert.deepEqual(await rows(), beforeExpiration);
});

async function historical(orderId, { key = randomUUID(), role = 'SELLER', type = 'ORDER_CREATED',
  status = 'PENDING', age = '1 hour', error = null, subject = 'Historical message', lease = '-1 minute' } = {}) {
  await db.query(`INSERT INTO seller_notifications
    (event_key,order_id,event_type,payload,recipient_role,recipient_email,subject,message,status,created_at,lease_until,last_error)
    VALUES($1,$2,$3,'{}',$4,'stale-buyer@example.com',$5,'Hola María. Mensaje para compartir.',$6,
      clock_timestamp()-$7::interval,clock_timestamp()+$8::interval,$9)`,
  [key, orderId, type, role, subject, status, age, lease, error]);
  return key;
}

test('historical customer, unauthorized and pickup-cancellation rows never escape any claim branch', async () => {
  const { order } = await created();
  await db.exec('DELETE FROM seller_notifications');
  for (const status of ['PENDING', 'RETRYABLE', 'SENDING']) {
    for (const type of [...authorizedTypes, 'ORDER_RESERVATION_EXPIRING', 'ORDER_RESERVATION_EXPIRED',
      'ORDER_CANCELLED', 'PICKUP_CANCELLED', 'PAYMENT_PROBLEM', 'UNKNOWN']) {
      for (const role of ['CUSTOMER', 'SELLER']) {
        if (role === 'SELLER' && authorizedTypes.includes(type)) continue;
        for (const age of ['1 hour', '48 hours']) {
          await historical(order.id, { status, type, role, age, error: 'provider_status_422',
            subject: type === 'PICKUP_CHANGED' ? `Retiro modificado · ${order.id}`
              : type === 'PICKUP_SCHEDULED' ? `Retiro agendado · ${order.id}` : 'Historical message' });
        }
      }
    }
    await historical(order.id, { status, type: 'PICKUP_CHANGED', subject: `Retiro cancelado · ${order.id}` });
    await historical(order.id, { status, type: 'PICKUP_SCHEDULED', subject: null });
  }
  const before = await rows();
  const calls = mockProvider();
  await drainSellerNotifications(500);
  assert.deepEqual(calls, []);
  assert.deepEqual(await rows(), before);
});

test('all six allowed seller events dispatch to the current configuration with original customer-ready text', async () => {
  const { args, order } = await created('buyer@example.com');
  await db.exec('DELETE FROM seller_notifications');
  for (const type of authorizedTypes) {
    await queueOrderNotifications({ query }, { key: `allowed:${type}`, order, type,
      details: { slot: slots[0], paymentState: 'FULLY_PAID', verifiedAmountPYG: 100_000 } });
  }
  await db.exec("UPDATE seller_notifications SET recipient_email='stale-buyer@example.com'");
  const before = await rows();
  process.env.SELLER_NOTIFICATION_TO = ' SELLER_NOTIFICATION_TO = current-seller@example.com ';
  const calls = mockProvider();
  await drainSellerNotifications(20);
  assert.equal(calls.length, 6);
  for (const row of before) {
    const sent = calls.find(call => call.key === row.event_key);
    assert.deepEqual(sent.to, ['current-seller@example.com']);
    assert.equal(sent.subject, row.subject);
    assert.equal(sent.text, row.message);
    assert.match(sent.text, /Hola María\./);
    assert.ok(sent.text.includes(notificationLinks(order.id, args.cartSessionId).privateOrderLink));
    assert.doesNotMatch(sent.text, /administrativ|Acción requerida|David,/);
  }
  assert.ok((await rows()).every(row => row.status === 'SENT' && row.recipient_email === 'current-seller@example.com'));
});

test('missing or invalid seller configuration fails closed without claiming or sending', async () => {
  await created();
  const before = await rows();
  const calls = mockProvider();
  for (const email of ['', '   ', 'invalid', 'buyer@example.com,seller@example.com',
    'Seller <seller@example.com>', 'seller@example.com\nBcc: buyer@example.com', 'seller@-bad.example',
    '.seller@example.com', 'seller..name@example.com', 'seller@example..com',
    `${'a'.repeat(65)}@example.com`, `seller@${'a'.repeat(64)}.example.com`]) {
    process.env.SELLER_NOTIFICATION_TO = email;
    await drainSellerNotifications();
    assert.deepEqual(await rows(), before);
  }
  delete process.env.SELLER_NOTIFICATION_TO;
  await drainSellerNotifications();
  assert.deepEqual(await rows(), before);
  assert.deepEqual(calls, []);
});

test('the final send guard independently rejects customer, unauthorized and cancelled-pickup rows', async () => {
  const calls = mockProvider();
  for (const forbidden of [
    { recipient_role: 'CUSTOMER', event_type: 'ORDER_CREATED' },
    { recipient_role: 'SELLER', event_type: 'ORDER_RESERVATION_EXPIRED' },
    { recipient_role: 'SELLER', event_type: 'PICKUP_CHANGED', subject: 'Retiro cancelado · VM-TEST' },
  ]) {
    const row = { event_key: 'synthetic-unsafe-row', order_id: 'VM-TEST', ...forbidden };
    query = async sql => ({ rows: sql.startsWith('SELECT * FROM seller_notifications') ||
      sql.startsWith('UPDATE seller_notifications SET status=') ? [row] : [] });
    await drainSellerNotifications(1);
  }
  assert.deepEqual(calls, []);
});

test('delivery failures preserve committed order/payment/pickup state and retries keep idempotency', async () => {
  const { order, change } = await scheduledOrder();
  await change(slots[0]);
  const state = async () => ({
    orders: await rows('SELECT * FROM checkout_attempts'),
    stock: await rows('SELECT * FROM operational_inventory'),
    reservations: await rows('SELECT * FROM inventory_reservations'),
    pickups: await rows('SELECT * FROM pickup_appointments'),
  });
  const committed = await state();
  const failed = mockProvider(500);
  await drainSellerNotifications(20);
  assert.equal(failed.length, 5);
  assert.ok((await rows()).every(row => row.status === 'RETRYABLE' && row.attempts === 1));
  assert.deepEqual(await state(), committed);
  await db.exec("UPDATE seller_notifications SET lease_until=clock_timestamp()-interval '1 minute'");
  process.env.SELLER_NOTIFICATION_TO = 'updated-seller@example.com';
  const retried = mockProvider();
  await drainSellerNotifications(20);
  assert.deepEqual(retried.map(call => call.key).sort(), failed.map(call => call.key).sort());
  assert.ok(retried.every(call => call.to.length === 1 && call.to[0] === 'updated-seller@example.com'));
  assert.ok((await rows()).every(row => row.status === 'SENT' && row.attempts === 2));
  assert.deepEqual(await state(), committed);
  assert.equal((await rows('SELECT order_snapshot FROM checkout_attempts WHERE order_id=$1', [order.id]))[0].order_snapshot.paymentState, 'FULLY_PAID');
  await drainSellerNotifications(20);
  assert.equal(retried.length, 5);
});

test('claim preserves retry age, active-lease, uncertain and success restrictions', async () => {
  const { order } = await created();
  await db.exec('DELETE FROM seller_notifications');
  const ready = [];
  for (const options of [
    { status: 'RETRYABLE' }, { status: 'SENDING' },
    { status: 'RETRYABLE', age: '48 hours', error: 'provider_status_422' },
  ]) ready.push(await historical(order.id, options));
  const blocked = [];
  for (const options of [
    { status: 'RETRYABLE', lease: '5 minutes' }, { status: 'SENDING', lease: '5 minutes' },
    { status: 'RETRYABLE', age: '48 hours', error: 'provider_status_500' },
    { status: 'RETRYABLE', age: '48 hours', error: 'provider_status_409' },
    { status: 'SENDING', age: '48 hours', error: 'provider_status_422' },
    { status: 'SENT' }, { status: 'UNCERTAIN' },
  ]) blocked.push(await historical(order.id, options));
  const before = await rows('SELECT * FROM seller_notifications WHERE event_key=ANY($1::text[]) ORDER BY event_key', [blocked]);
  const calls = mockProvider();
  await drainSellerNotifications(20);
  assert.deepEqual(calls.map(call => call.key).sort(), ready.sort());
  assert.deepEqual(await rows('SELECT * FROM seller_notifications WHERE event_key=ANY($1::text[]) ORDER BY event_key', [blocked]), before);
});

test('queue conflict is idempotent and safe dispatch catches infrastructure failures', async () => {
  const { order } = await created();
  await queueOrderNotifications({ query }, { key: `order:${order.id}`, order, type: 'ORDER_CREATED' });
  assert.equal((await rows()).length, 1);
  const committed = await rows('SELECT * FROM checkout_attempts');
  query = () => { throw new Error('Synthetic database outage'); };
  await dispatchSellerNotificationsSafely();
  assert.deepEqual(await rows('SELECT * FROM checkout_attempts'), committed);
});

async function fixturePickup(slotKey, { timingKey = 'IMMEDIATE', buyer, items } = {}) {
  const { order } = await created();
  const paid = (await pay(order.id, 100_000)).order;
  const snapshot = { ...paid, buyer: buyer || paid.buyer, items: items || paid.items };
  await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1',
    [order.id, JSON.stringify(snapshot)]);
  await db.query('INSERT INTO pickup_windows(slot_key) VALUES($1) ON CONFLICT DO NOTHING', [slotKey]);
  await db.query(`INSERT INTO pickup_appointments(order_id,timing_key,slot_key,status,changed_by)
    VALUES($1,$2,$3,'SCHEDULED','CUSTOMER')`, [order.id, timingKey, slotKey]);
  return snapshot;
}

test('reading and retaining a legacy half-day appointment never changes it or queues mail', async () => {
  const legacy = await fixturePickup('2026-11-02|08:00-12:00');
  const before = await rows('SELECT * FROM pickup_appointments');
  const notices = await rows();
  const [part] = await pickupFulfillments(legacy);
  assert.equal(part.appointment.slotKey, '2026-11-02|08:00-12:00');
  assert.ok(!part.slots.some(slot => slot.key === part.appointment.slotKey));
  assert.equal((await listUpcomingPickups()).find(p => p.orderId === legacy.id).slotKey,
    '2026-11-02|08:00-12:00');
  await changePickup({ orderId: legacy.id, timingKey: 'IMMEDIATE',
    slotKey: part.appointment.slotKey, actor: 'CUSTOMER' });
  assert.deepEqual(await rows('SELECT * FROM pickup_appointments'), before);
  assert.deepEqual(await rows(), notices);
});

test('availability counts legacy overlap, respects touching endpoints and ignores cancelled rows', async () => {
  for (let i = 0; i < 3; i++) await fixturePickup('2026-11-02|08:00-12:00');
  await fixturePickup('2026-11-02|10:00-11:00');
  const cancelled = await fixturePickup('2026-11-02|10:00-11:00');
  await db.query("UPDATE pickup_appointments SET status='CANCELLED',slot_key=NULL WHERE order_id=$1", [cancelled.id]);
  const { order } = await created();
  const buyer = (await pay(order.id, 100_000)).order;
  const available = new Map((await pickupAvailability(buyer, 'IMMEDIATE')).map(s => [s.key, s.remaining]));
  assert.equal(available.get('2026-11-02|08:00-09:00'), 1);
  assert.equal(available.get('2026-11-02|09:00-10:00'), 1);
  assert.equal(available.get('2026-11-02|10:00-11:00'), 0);
  assert.equal(available.get('2026-11-02|11:00-12:00'), 1);
  assert.equal(available.get('2026-11-02|12:00-13:00'), 4);
  await assert.rejects(changePickup({ orderId: buyer.id, timingKey: 'IMMEDIATE',
    slotKey: '2026-11-02|10:00-11:00', actor: 'ADMIN' }), /completo/);
});

test('a full legacy window permits its own replacement; failed replacement retains the appointment', async () => {
  const legacy = [];
  for (let i = 0; i < 4; i++) legacy.push(await fixturePickup('2026-11-02|08:00-12:00'));
  for (let i = 0; i < 4; i++) await fixturePickup('2026-11-03|13:00-14:00');
  const before = await rows('SELECT * FROM pickup_appointments WHERE order_id=$1', [legacy[0].id]);
  const notices = await rows();
  await assert.rejects(changePickup({ orderId: legacy[0].id, timingKey: 'IMMEDIATE',
    slotKey: '2026-11-03|13:00-14:00', actor: 'CUSTOMER' }), /completo/);
  assert.deepEqual(await rows('SELECT * FROM pickup_appointments WHERE order_id=$1', [legacy[0].id]), before);
  assert.deepEqual(await rows(), notices);
  const available = await pickupAvailability(legacy[0], 'IMMEDIATE', { status: 'SCHEDULED', slotKey: before[0].slot_key });
  assert.equal(available.find(s => s.key === '2026-11-02|10:00-11:00').remaining, 1);
  const result = await changePickup({ orderId: legacy[0].id, timingKey: 'IMMEDIATE',
    slotKey: '2026-11-02|10:00-11:00', actor: 'CUSTOMER' });
  assert.equal(result.slotKey, '2026-11-02|10:00-11:00');
  assert.equal(result.revision, 2);
});

test('failure to enqueue either pickup message rolls back the replacement and both outbox rows', async () => {
  for (const failAgenda of [false, true]) {
    const legacy = await fixturePickup('2026-11-02|08:00-12:00');
    const before = await rows();
    query = (sql, params = []) => {
      if (sql.includes('INSERT INTO seller_notifications') && params[0].endsWith(failAgenda ? ':agenda' : ':seller')) {
        throw new Error('Synthetic pickup outbox failure');
      }
      return db.query(sql, params);
    };
    await assert.rejects(changePickup({ orderId: legacy.id, timingKey: 'IMMEDIATE',
      slotKey: '2026-11-02|10:00-11:00', actor: 'ADMIN' }), /outbox failure/);
    assert.equal((await rows('SELECT slot_key FROM pickup_appointments WHERE order_id=$1', [legacy.id]))[0].slot_key,
      '2026-11-02|08:00-12:00');
    assert.deepEqual(await rows(), before);
    query = (sql, params = []) => db.query(sql, params);
  }
});

test('upcoming schedule excludes finished and cancelled appointments using Paraguay end times', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-02T11:30:00-03:00') });
  const past = await fixturePickup('2026-11-01|19:00-20:00');
  const ended = await fixturePickup('2026-11-02|10:00-11:00');
  const ongoing = await fixturePickup('2026-11-02|08:00-12:00');
  const next = await fixturePickup('2026-11-02|12:00-13:00');
  const cancelled = await fixturePickup('2026-11-02|13:00-14:00');
  await db.query("UPDATE pickup_appointments SET status='CANCELLED',slot_key=NULL WHERE order_id=$1", [cancelled.id]);
  const agenda = await listUpcomingPickups();
  assert.deepEqual(agenda.map(p => p.orderId), [ongoing.id, next.id]);
  assert.ok(agenda.every(p => ![past.id, ended.id, cancelled.id].includes(p.orderId)));
  assert.deepEqual(await listUpcomingPickups({ now: new Date('2026-11-02T13:00:00-03:00') }), []);
});

test('first agenda dispatch reads all committed changes chronologically with buyer, type, item IDs and quantities', async () => {
  const late = await fixturePickup('2026-12-10|15:00-16:00', {
    timingKey: 'DELAYED:2026-12-09:2026-12-12', buyer: { name: 'Zulma', phone: '+595 333' },
    items: [{ productId: 'delayed-product', itemNumber: 474, quantity: 2, saleMode: 'DELAYED',
      pickupWindowStart: '2026-12-09', pickupWindowEnd: '2026-12-12' }],
  });
  const { order, change } = await scheduledOrder();
  await change(slots[0]);
  // This different order commits after the notification was queued. It must
  // appear on the first dispatch; the changed order must show its latest slot.
  const early = await fixturePickup('2026-11-02|08:00-12:00', {
    buyer: { name: 'Ana <synthetic>', phone: '+595 111' },
    items: [{ productId: 'legacy-product', itemNumber: 381, quantity: 3, saleMode: 'IMMEDIATE' }],
  });
  await change(slots[1]);
  const calls = mockProvider();
  await drainSellerNotifications(100);
  const agendas = calls.filter(c => c.key.endsWith(':agenda'));
  assert.equal(agendas.length, 2);
  for (const agenda of agendas) {
    assert.match(agenda.subject, /Agenda administrativa.*solo vendedor/);
    assert.deepEqual(agenda.to, ['seller@example.com']);
    assert.match(agenda.text, /SOLO VENDEDOR.*No compartir/);
    assert.match(agenda.text, /Generada: .*America\/Asuncion \(Paraguay\)/);
    const schedule = agenda.text.split('Agenda completa')[1];
    assert.ok(schedule.indexOf(early.id) < schedule.indexOf(order.id));
    assert.ok(schedule.indexOf(order.id) < schedule.indexOf(late.id));
    assert.match(schedule, /Ana <synthetic>.*Teléfono: \+595 111/);
    assert.match(schedule, /08:00 a 12:00/);
    assert.match(schedule, /#381 · ID legacy-product · cantidad 3/);
    assert.match(schedule, /Zulma.*Teléfono: \+595 333/);
    assert.match(schedule, /#474 · ID delayed-product · cantidad 2/);
    assert.match(schedule, /Retiro inmediato/);
    assert.match(schedule, /Retiro posterior/);
    assert.ok(schedule.includes('10 de diciembre de 2026'));
    assert.ok(!schedule.includes('9 de diciembre de 2026'));
  }
  assert.match(agendas[0].text, /Cambio: Retiro creado/);
  assert.match(agendas[1].text, /Cambio: Retiro reprogramado/);
  const ready = calls.filter(c => c.key.startsWith(`pickup:${order.id}:`) && !c.key.endsWith(':agenda'));
  assert.equal(ready.length, 2);
  for (const email of ready) assert.doesNotMatch(email.text, /Zulma|Ana <synthetic>|Agenda completa/);
});

test('uncertain delivery retries freeze both pickup bodies and keys while newer changes get a fresh agenda', async () => {
  const { order, change } = await scheduledOrder();
  await change(slots[0]);
  await db.exec("DELETE FROM seller_notifications WHERE event_type NOT LIKE 'PICKUP_%'");
  const failed = [];
  globalThis.fetch = async (_url, options) => {
    failed.push({ ...JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
    throw new Error('Synthetic provider timeout after possible acceptance');
  };
  await drainSellerNotifications(20);
  assert.equal(failed.length, 2);
  await change(slots[1]);
  await db.exec("UPDATE seller_notifications SET lease_until=clock_timestamp()-interval '1 minute' WHERE status='RETRYABLE'");
  const delivered = mockProvider();
  await drainSellerNotifications(20);
  for (const attempt of failed) {
    const retried = delivered.find(c => c.key === attempt.key);
    assert.deepEqual(retried, attempt);
  }
  const newAgenda = delivered.find(c => c.key.endsWith(':2:seller:agenda'));
  assert.ok(newAgenda.text.split('Agenda completa')[1].includes('10 de diciembre de 2026'));
  assert.equal((await rows('SELECT slot_key FROM pickup_appointments WHERE order_id=$1', [order.id]))[0].slot_key, slots[1]);
  await drainSellerNotifications(20);
  assert.equal(delivered.length, 4);
});

test('agenda generation failure releases its claim and leaves both durable messages recoverable', async () => {
  const { change } = await scheduledOrder();
  await change(slots[0]);
  await db.exec("DELETE FROM seller_notifications WHERE event_type NOT LIKE 'PICKUP_%'");
  query = (sql, params = []) => {
    if (sql.includes('FROM pickup_appointments a JOIN checkout_attempts')) throw new Error('Synthetic agenda read failure');
    return db.query(sql, params);
  };
  const calls = mockProvider();
  await dispatchSellerNotificationsSafely();
  const [agenda] = await rows("SELECT * FROM seller_notifications WHERE event_key LIKE '%:agenda'");
  assert.equal(agenda.status, 'PENDING');
  assert.equal(agenda.attempts, 0);
  assert.equal(calls.length, 1);
  query = (sql, params = []) => db.query(sql, params);
  await drainSellerNotifications(20);
  assert.equal(calls.length, 2);
  assert.ok((await rows()).every(r => r.status === 'SENT'));
});

test('administrative-looking historical rows without the complete new envelope remain untouched', async () => {
  const { order } = await created();
  await db.exec('DELETE FROM seller_notifications');
  for (const status of ['PENDING', 'RETRYABLE', 'SENDING']) {
    for (const role of ['SELLER', 'CUSTOMER']) {
      await historical(order.id, { type: 'PICKUP_CHANGED', role, status,
        subject: `Agenda administrativa de retiros (solo vendedor) · ${order.id}` });
    }
  }
  const before = await rows();
  const calls = mockProvider();
  await drainSellerNotifications(100);
  assert.deepEqual(calls, []);
  assert.deepEqual(await rows(), before);
});

test('each pickup email retries independently when only its provider request fails', async () => {
  for (const failAgenda of [false, true]) {
    await db.exec('TRUNCATE cart_sessions,operational_inventory RESTART IDENTITY CASCADE');
    const { change } = await scheduledOrder();
    await change(slots[0]);
    await db.exec("DELETE FROM seller_notifications WHERE event_type NOT LIKE 'PICKUP_%'");
    const first = [];
    globalThis.fetch = async (_url, options) => {
      const key = options.headers['Idempotency-Key'];
      first.push(key);
      return new Response(JSON.stringify({ id: 'mock-id' }), {
        status: key.endsWith(':agenda') === failAgenda ? 503 : 200 });
    };
    await drainSellerNotifications(20);
    assert.equal(first.length, 2);
    assert.equal((await rows()).filter(r => r.status === 'SENT').length, 1);
    const [retry] = (await rows()).filter(r => r.status === 'RETRYABLE');
    assert.equal(retry.event_key.endsWith(':agenda'), failAgenda);
    await db.exec("UPDATE seller_notifications SET lease_until=clock_timestamp()-interval '1 minute' WHERE status='RETRYABLE'");
    const retried = mockProvider();
    await drainSellerNotifications(20);
    assert.deepEqual(retried.map(c => c.key), [retry.event_key]);
    assert.ok((await rows()).every(r => r.status === 'SENT'));
    assert.equal((await rows('SELECT status FROM pickup_appointments'))[0].status, 'SCHEDULED');
  }
});

test('a slot that starts while waiting for the day lock is rejected without losing the old appointment', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-02T11:59:00-03:00') });
  const legacy = await fixturePickup('2026-11-02|08:00-12:00');
  const before = await rows();
  query = (sql, params = []) => {
    if (sql.includes('SELECT slot_key FROM pickup_windows')) {
      t.mock.timers.setTime(Date.parse('2026-11-02T12:00:00-03:00'));
    }
    return db.query(sql, params);
  };
  await assert.rejects(changePickup({ orderId: legacy.id, timingKey: 'IMMEDIATE',
    slotKey: '2026-11-02|12:00-13:00', actor: 'CUSTOMER' }), /no está disponible/);
  assert.deepEqual(await rows(), before);
  assert.equal((await rows('SELECT slot_key FROM pickup_appointments WHERE order_id=$1', [legacy.id]))[0].slot_key,
    '2026-11-02|08:00-12:00');
});
