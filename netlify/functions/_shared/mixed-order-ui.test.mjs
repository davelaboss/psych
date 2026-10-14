import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const checkout = await readFile(new URL('../../../js/checkout.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');
const customerPickup = await readFile(new URL('../customer-pickup.mjs', import.meta.url), 'utf8');
const adminPickup = await readFile(new URL('../admin-pickup.mjs', import.meta.url), 'utf8');
const pickup = await readFile(new URL('./pickup.mjs', import.meta.url), 'utf8');

test('customer portal renders and schedules each fulfillment timing independently', () => {
  assert.match(checkout, /order\.fulfillments/);
  assert.match(checkout, /Pago requerido ahora/);
  assert.match(checkout, /Saldo posterior de estos artículos/);
  assert.match(checkout, /data-pickup-timing-key/);
  assert.match(checkout, /timingKey: form\.dataset\.pickupTimingKey/);
  assert.match(checkout, /Todavía no disponible para retiro/);
});

test('customer and admin pickup endpoints preserve their existing authorization boundaries', () => {
  assert.match(customerPickup, /getAuthorizedOrder\(orderId, access\)/);
  assert.match(customerPickup, /fulfillments: await pickupFulfillments\(order\)/);
  assert.match(customerPickup, /changePickup\(\{ orderId, timingKey, slotKey, actor: 'CUSTOMER' \}\)/);
  assert.match(adminPickup, /adminAuthorized\(request\)/);
  assert.match(adminPickup, /changePickup\(\{ orderId, timingKey, slotKey: params\.slotKey \|\| null, actor: 'ADMIN' \}\)/);
});

test('admin order detail separates fulfillment, money, grouping, pickup, and actions', () => {
  for (const heading of [
    '1. Pedido y comprador', '2. Artículos y retiro', '3. Estado financiero',
    '4. Comprador y agrupación', '5. Retiros', '6. Historial de pagos',
    '7. Comprobantes / registrar pago', '8. Ajustes y reembolsos', '9. Acciones / contacto',
  ]) assert.match(admin, new RegExp(heading.replace(/[./]/g, '\\$&')));
  assert.match(admin, /data-merge-buyer-group/);
  assert.match(admin, /data-separate-buyer-group/);
  assert.match(admin, /Se combinarán los pedidos/);
  assert.match(admin, /data-admin-pickup-part/);
  assert.doesNotMatch(admin, /Disponible después de confirmar el pago total\./);
});

test('planillas explain absent combine targets and preserve timing compatibility checks', () => {
  assert.match(admin, /candidate\.buyerGroupId === batch\.buyerGroupId/);
  assert.match(admin, /candidate\.timingKey === batch\.timingKey/);
  assert.match(admin, /candidate\.status !== 'DELIVERED'/);
  assert.match(admin, /No hay otra planilla compatible para este comprador y tipo de retiro/);
  assert.match(admin, /Los otros artículos de este comprador tienen un tipo de retiro diferente/);
});

test('appointment writes and notification keys are timing-specific', () => {
  assert.match(pickup, /ON CONFLICT\(order_id,timing_key\)/);
  assert.match(pickup, /WHERE order_id=\$1 AND timing_key=\$2 FOR UPDATE/);
  assert.match(pickup, /`pickup:\$\{orderId\}:\$\{normalizedTimingKey\}:\$\{row\.revision\}`/);
});
