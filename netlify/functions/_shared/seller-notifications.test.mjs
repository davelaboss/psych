import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerNotification, notificationLinks } from './seller-notifications.mjs';

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
    const text = render('PAYMENT_CONFIRMED', { items: [{ saleMode }] });
    assertEnvelope(text);
    assert.match(text, /Confirmamos el pago total de tu pedido VM-2026-TEST\./);
    assert.match(text, /Ya podés elegir el horario de retiro desde este enlace:/);
    assertOneOrderAction(text, true);
  }
});

test('deposit confirmation keeps delayed orders on the private order page', () => {
  const text = render('PAYMENT_CONFIRMED', { remainingBalancePYG: 75000, items: [{ saleMode: 'DELAYED' }] });
  assertEnvelope(text);
  assert.match(text, /Confirmamos la seña/);
  assertOneOrderAction(text);
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
