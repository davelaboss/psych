import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  customerNotification,
  notificationLinks,
  queueOrderNotifications,
} from './seller-notifications.mjs';

const order = (overrides = {}) => ({
  id: 'VM-2026-TEST',
  buyer: { name: 'María', phone: '+595 981 000000', email: 'maria@example.com' },
  holdExpiresAt: Date.parse('2026-10-03T18:00:00-03:00'),
  remainingBalancePYG: 0,
  items: [{ saleMode: 'IMMEDIATE' }],
  ...overrides,
});

const links = notificationLinks('VM-2026-TEST', 'cart-session', 'https://example.com');
const render = (type, overrides = {}, details = {}) => customerNotification({
  order: order(overrides), type, details, ...links,
}).text;

const header = 'Cliente: María\nWhatsApp: +595 981 000000\nPedido: VM-2026-TEST';
const footer = '¡Gracias!\n\nLos LaBossiere';

function assertEnvelope(text) {
  assert.ok(text.startsWith(`${header}\n\nHola María.`));
  assert.ok(text.endsWith(footer));
}

function assertOneOrderAction(text, scheduler = false) {
  const matches = text.match(/https:\/\/example\.com\/pedido\/VM-2026-TEST\?access=[0-9a-f]+(?:#pickup-scheduler)?/g) || [];
  assert.equal(matches.length, 1);
  assert.equal(matches[0].endsWith('#pickup-scheduler'), scheduler);
}

const notificationTypes = [
  'ORDER_CREATED',
  'RECEIPT_UPLOADED',
  'FINAL_RECEIPT_UPLOADED',
  'PAYMENT_CONFIRMED',
  'PICKUP_SCHEDULED',
  'PICKUP_CHANGED',
];

async function queuedRows(type, email) {
  const rows = [];
  const queries = [];
  const client = { async query(sql, params = []) {
    queries.push(sql);
    if (sql.includes('SELECT session_id FROM checkout_attempts')) {
      return { rows: [{ session_id: 'cart-session' }] };
    }
    if (sql.includes('INSERT INTO seller_notifications')) {
      rows.push({
        eventKey: params[0],
        orderId: params[1],
        eventType: params[2],
        payload: JSON.parse(params[3]),
        recipientRole: params[4],
        recipientEmail: params[5],
        subject: params[6],
        message: params[7],
      });
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await queueOrderNotifications(client, {
    key: `event:${type.toLowerCase()}`,
    order: order({ buyer: { ...order().buyer, email } }),
    type,
    details: type === 'PAYMENT_CONFIRMED'
      ? { paymentState: 'FULLY_PAID', verifiedAmountPYG: 100_000 }
      : type.startsWith('PICKUP_') ? { slot: '2026-12-09|08:00-12:00' } : {},
  });
  return { rows, queries };
}

test('every authorized event queues only the seller, independently of buyer email', async () => {
  for (const email of ['  maria@example.com  ', 'other@example.org', '', '   ', null, undefined]) {
    for (const type of notificationTypes) {
      const { rows } = await queuedRows(type, email);
      assert.equal(rows.length, 1, `${type} / ${String(email)}`);
      assert.equal(rows[0].recipientRole, 'SELLER', type);
      assert.equal(rows[0].recipientEmail, null, type);
      assert.equal(rows[0].eventType, type);
      assert.equal(rows[0].eventKey, `event:${type.toLowerCase()}:seller`);
      assert.deepEqual(rows[0].payload, { orderId: 'VM-2026-TEST' });
    }
  }
});

test('unauthorized events never touch the notification queue, regardless of buyer email', async () => {
  for (const email of ['maria@example.com', '', '   ', null]) {
    for (const type of ['ORDER_RESERVATION_EXPIRING', 'ORDER_RESERVATION_EXPIRED',
      'ORDER_CANCELLED', 'PICKUP_CANCELLED', 'PAYMENT_PROBLEM', 'ERROR', 'UNKNOWN']) {
      const { rows, queries } = await queuedRows(type, email);
      assert.deepEqual(rows, [], type);
      assert.deepEqual(queries, [], type);
    }
  }
});

test('pickup events without a new slot never enqueue the cancellation template', async () => {
  const client = { query() { throw new Error('Cancelled pickup must not query the queue'); } };
  for (const type of ['PICKUP_SCHEDULED', 'PICKUP_CHANGED']) {
    for (const slot of [null, undefined, '']) {
      await queueOrderNotifications(client, { key: 'cancel', order: order(), type, details: { slot } });
    }
  }
});

test('queued rows preserve approved copy, tokenized links, subjects, and role-qualified idempotency keys', async () => {
  const receipt = (await queuedRows('RECEIPT_UPLOADED', 'maria@example.com')).rows[0];
  assert.equal(receipt.subject, 'Comprobante recibido · VM-2026-TEST');
  assert.match(receipt.message, /Recibimos el comprobante de tu pedido VM-2026-TEST\./);
  assert.match(receipt.message, /La carga del comprobante no confirma el pago automáticamente\./);
  assert.match(receipt.message, /https?:\/\/localhost:8888\/pedido\/VM-2026-TEST\?access=[0-9a-f]+/);
  assert.doesNotMatch(receipt.message, /admin/i);
  assert.equal(receipt.eventKey, 'event:receipt_uploaded:seller');

  const created = (await queuedRows('ORDER_CREATED', '')).rows[0];
  assert.equal(created.subject, 'Pedido VM-2026-TEST recibido');
  assert.match(created.message, /realizá la transferencia y cargá el comprobante/);
  assert.match(created.message, /https?:\/\/localhost:8888\/pedido\/VM-2026-TEST\?access=[0-9a-f]+/);
  assert.equal(created.eventKey, 'event:order_created:seller');
});

test('order-created email uses the approved copy and private order link', () => {
  const text = render('ORDER_CREATED');
  assertEnvelope(text);
  assert.match(text, /¡Gracias por tu pedido! Tus artículos quedaron reservados hasta/);
  assert.match(text, /Para conservar la reserva, realizá la transferencia y cargá el comprobante/);
  assert.match(text, /los artículos podrán volver a estar disponibles para otros compradores/);
  assertOneOrderAction(text);
});

test('receipt emails use the approved verification copy and private order link', () => {
  for (const type of ['RECEIPT_UPLOADED', 'FINAL_RECEIPT_UPLOADED']) {
    const text = render(type);
    assertEnvelope(text);
    assert.match(text, /Recibimos el comprobante de tu pedido VM-2026-TEST\./);
    assert.match(text, /La carga del comprobante no confirma el pago automáticamente\./);
    assertOneOrderAction(text);
  }
});

test('full payment for immediate and delayed orders links directly to the pickup scheduler', () => {
  for (const saleMode of ['IMMEDIATE', 'DELAYED']) {
    const text = render('PAYMENT_CONFIRMED', {
      paidAmountPYG: 100_000, remainingBalancePYG: 0, items: [{ saleMode }],
    }, { paymentState: 'FULLY_PAID', verifiedAmountPYG: 100_000, previousConfirmedPaidPYG: 0 });
    assertEnvelope(text);
    assert.match(text, /Confirmamos el pago total de tu pedido VM-2026-TEST\./);
    assert.match(text, /Ya podés elegir el horario de retiro desde este enlace:/);
    assertOneOrderAction(text, true);
  }
});

test('deposit confirmation keeps delayed orders on the private order page', () => {
  const text = render('PAYMENT_CONFIRMED', {
    remainingBalancePYG: 75_000,
    paidAmountPYG: 25_000,
    totals: { dueNowPYG: 25_000 },
    items: [{ saleMode: 'DELAYED' }],
  }, { paymentState: 'DEPOSIT_SATISFIED', verifiedAmountPYG: 25_000, previousConfirmedPaidPYG: 0 });
  assertEnvelope(text);
  assert.match(text, /La seña de tu pedido VM-2026-TEST está completa/);
  assertOneOrderAction(text);
});

test('mixed-order due-now confirmation links to the immediate scheduler without claiming delayed is ready', () => {
  const text = render('PAYMENT_CONFIRMED', {
    status: 'DEPOSIT_CONFIRMED', remainingBalancePYG: 37_500, paidAmountPYG: 72_500,
    totals: { totalPYG: 110_000, dueNowPYG: 72_500, futureBalancePYG: 37_500 },
    paymentAdjustments: [],
    payments: [{ id: 'confirmed', type: 'DEPOSIT', amountPYG: 72_500,
      amountSource: 'ADMIN_VERIFIED', verifiedBy: 'ADMIN', verificationStatus: 'CONFIRMED' }],
    items: [
      { productId: '381', saleMode: 'IMMEDIATE', quantity: 1, unitPricePYG: 60_000,
        dueNowPYG: 60_000, futureBalancePYG: 0 },
      { productId: '474', saleMode: 'DELAYED', quantity: 1, unitPricePYG: 50_000,
        dueNowPYG: 12_500, futureBalancePYG: 37_500 },
    ],
  }, { paymentState: 'DEPOSIT_SATISFIED', verifiedAmountPYG: 72_500, previousConfirmedPaidPYG: 0 });
  assert.match(text, /Los artículos de retiro inmediato ya se pueden agendar/);
  assert.match(text, /El retiro posterior seguirá esperando el pago final/);
  assertOneOrderAction(text, true);
});

test('payment confirmation copy distinguishes partial, installment, and fully paid states', () => {
  const partial = render('PAYMENT_CONFIRMED', {
    remainingBalancePYG: 1_505_000,
    paidAmountPYG: 495_000,
    depositShortfallPYG: 5_000,
    totals: { dueNowPYG: 500_000 },
    items: [{ saleMode: 'DELAYED' }],
  }, { paymentState: 'PARTIALLY_PAID', verifiedAmountPYG: 495_000, previousConfirmedPaidPYG: 0 });
  assert.match(partial, /pago parcial de Gs\. 495\.000/i);
  assertOneOrderAction(partial);

  const installment = render('PAYMENT_CONFIRMED', {
    remainingBalancePYG: 1_400_000,
    paidAmountPYG: 600_000,
    totals: { dueNowPYG: 500_000 },
    items: [{ saleMode: 'DELAYED' }],
  }, { paymentState: 'DEPOSIT_SATISFIED', verifiedAmountPYG: 100_000, previousConfirmedPaidPYG: 500_000 });
  assert.match(installment, /pago adicional de Gs\. 100\.000/i);
  assertOneOrderAction(installment);

  const full = render('PAYMENT_CONFIRMED', {
    remainingBalancePYG: 0,
    paidAmountPYG: 2_000_000,
    totals: { dueNowPYG: 500_000 },
    items: [{ saleMode: 'DELAYED' }],
  }, { paymentState: 'FULLY_PAID', verifiedAmountPYG: 1_400_000, previousConfirmedPaidPYG: 600_000 });
  assert.match(full, /último importe verificado fue Gs\. 1\.400\.000/i);
  assertOneOrderAction(full, true);
});

test('payment notifications never include internal payment notes or adjustment details', () => {
  const text = render('PAYMENT_CONFIRMED', {
    remainingBalancePYG: 1_505_000,
    paidAmountPYG: 495_000,
    depositShortfallPYG: 5_000,
    totals: { dueNowPYG: 500_000 },
    items: [{ saleMode: 'DELAYED' }],
    paymentNotes: [{ text: 'INTERNAL-SECRET-ARRANGEMENT' }],
    paymentAdjustments: [{ internalNote: 'INTERNAL-SECRET-REFUND' }],
  }, { paymentState: 'PARTIALLY_PAID', verifiedAmountPYG: 495_000, previousConfirmedPaidPYG: 0 });
  assert.doesNotMatch(text, /INTERNAL-SECRET/);
});

test('scheduled and rescheduled pickup emails include date, time, map, and one private order action', () => {
  for (const type of ['PICKUP_SCHEDULED', 'PICKUP_CHANGED']) {
    const text = render(type, {}, { slot: '2026-12-09|08:00-12:00' });
    assertEnvelope(text);
    assert.match(text, /¡Gracias! Tu horario de retiro quedó registrado\./);
    assert.match(text, /Fecha:\n9 de diciembre de 2026/);
    assert.match(text, /Hora:\n08:00 a 12:00/);
    assert.match(text, /https:\/\/goo\.gl\/maps\/TMeEA6Fnoe1tcCmYA\?g_st=aw/);
    assertOneOrderAction(text);
  }
});

test('every remaining customer notification has the standard envelope and one action link', () => {
  for (const [type, details, scheduler] of [
    ['ORDER_RESERVATION_EXPIRING', {}, false],
    ['ORDER_RESERVATION_EXPIRED', {}, false],
    ['PICKUP_CHANGED', { slot: null }, true],
  ]) {
    const text = render(type, {}, details);
    assertEnvelope(text);
    assertOneOrderAction(text, scheduler);
  }
});
