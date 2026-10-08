import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const inventory = await readFile(new URL('./inventory-database.mjs', import.meta.url), 'utf8');
const endpoint = await readFile(new URL('../admin-payment-note.mjs', import.meta.url), 'utf8');
const pickup = await readFile(new URL('./pickup.mjs', import.meta.url), 'utf8');
const admin = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');

function functionSource(source, start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

test('legacy reconciliation locks before calculation and writes one snapshot atomically', () => {
  const reconciliation = functionSource(inventory,
    'export async function reconcileOrderLegacyPayment', 'export async function voidOrderLegacyDuplicatePayment');
  assert.match(reconciliation, /return inventoryTransaction\(async client =>/);
  assert.match(inventory, /SELECT \* FROM checkout_attempts WHERE order_id=\$1 FOR UPDATE/);
  assert.ok(reconciliation.indexOf('await orderLock(client, orderId)') <
    reconciliation.indexOf('reconcileLegacyPaymentState(locked.row.order_snapshot'));
  assert.ok(reconciliation.indexOf('reconcileLegacyPaymentState(locked.row.order_snapshot') <
    reconciliation.indexOf('UPDATE checkout_attempts SET order_snapshot=$2'));
  assert.equal((reconciliation.match(/UPDATE checkout_attempts/g) || []).length, 1);
  assert.match(reconciliation, /projection_version=projection_version\+1/);
});

test('validation failure happens before the snapshot write and triggers transaction rollback', () => {
  const transaction = functionSource(inventory,
    'export async function inventoryTransaction', 'async function sessionLock');
  const reconciliation = functionSource(inventory,
    'export async function reconcileOrderLegacyPayment', 'export async function voidOrderLegacyDuplicatePayment');
  assert.ok(reconciliation.indexOf('reconcileLegacyPaymentState(locked.row.order_snapshot') <
    reconciliation.indexOf('UPDATE checkout_attempts SET order_snapshot=$2'));
  assert.match(transaction, /await client\.query\('ROLLBACK'\)/);
});

test('legacy reconciliation performs no inventory, reservation, pickup, or fulfillment mutation', () => {
  const reconciliation = functionSource(inventory,
    'export async function reconcileOrderLegacyPayment', 'export async function voidOrderLegacyDuplicatePayment');
  assert.doesNotMatch(reconciliation,
    /UPDATE operational_inventory|UPDATE inventory_reservations|INSERT INTO pickup_|UPDATE pickup_|fulfillment_batch/i);
});

test('legacy duplicate void locks before calculation and writes one snapshot atomically', () => {
  const voiding = functionSource(inventory,
    'export async function voidOrderLegacyDuplicatePayment', 'export async function commitInventoryHold');
  assert.match(voiding, /return inventoryTransaction\(async client =>/);
  assert.ok(voiding.indexOf('await orderLock(client, orderId)') <
    voiding.indexOf('voidLegacyDuplicatePaymentState(locked.row.order_snapshot'));
  assert.ok(voiding.indexOf('voidLegacyDuplicatePaymentState(locked.row.order_snapshot') <
    voiding.indexOf('UPDATE checkout_attempts SET order_snapshot=$2'));
  assert.match(voiding, /const timestamp = await now\(client\)/);
  assert.match(voiding, /\{ \.\.\.voiding, timestamp \}/);
  assert.equal((voiding.match(/UPDATE checkout_attempts/g) || []).length, 1);
  assert.match(voiding, /projection_version=projection_version\+1/);
});

test('legacy duplicate void performs no unrelated mutation or notification', () => {
  const voiding = functionSource(inventory,
    'export async function voidOrderLegacyDuplicatePayment', 'export async function commitInventoryHold');
  assert.doesNotMatch(voiding,
    /operational_inventory|inventory_reservations|pickup_|fulfillment_batch|queueOrderNotifications/i);
});

test('server endpoint exposes only the two approved historical payment actions', () => {
  assert.match(endpoint, /'RECONCILE_LEGACY_PAYMENT', 'VOID_LEGACY_DUPLICATE_PAYMENT'/);
  assert.doesNotMatch(endpoint, /ADD_NOTE/);
  assert.match(endpoint, /reconcileOrderLegacyPayment/);
  assert.match(endpoint, /voidOrderLegacyDuplicatePayment/);
});

test('admin exposes the standalone legacy reconciliation form without generic notes', () => {
  assert.match(admin, /Importe histórico asumido: requiere reconciliación antes de otro pago\./);
  assert.match(admin, /data-reconcile-payment/);
  assert.match(admin, /Reconciliar pago histórico/);
  assert.match(admin, /Monto comprobado en banco\/comprobante/);
  assert.match(admin, /Crédito histórico aprobado por el vendedor/);
  assert.doesNotMatch(admin, /action: 'ADD_NOTE'/);
});

test('admin exposes explicit legacy duplicate voiding and keeps the audit entry visible', () => {
  assert.match(admin, /data-void-legacy-payment/);
  assert.match(admin, /Anular pago histórico duplicado/);
  assert.match(admin, /action: 'VOID_LEGACY_DUPLICATE_PAYMENT'/);
  assert.match(admin, /window\.confirm/);
  assert.match(admin, /ANULADO — pago histórico duplicado/);
  assert.match(admin, /Nota interna de auditoría/);
  assert.match(admin, /payment\.receipt/);
  assert.match(admin, /nonVoidedConfirmedPayments\.length > 1/);
  assert.match(admin, /LEGACY_RECONCILED/);
  assert.match(admin, /LEGACY_OPENING_CREDIT/);
});

test('existing production payment confirmation behavior remains present', () => {
  const confirmation = functionSource(inventory,
    'export async function confirmOrderPayment', 'export async function reconcileOrderLegacyPayment');
  assert.match(confirmation, /const amount = type === 'DEPOSIT'/);
  assert.match(confirmation, /committed_quantity=committed_quantity\+\$2/);
  assert.match(confirmation, /key: `payment:\$\{existing\.id\}`/);
  assert.match(confirmation, /type: 'PAYMENT_CONFIRMED'/);
});

test('existing production pickup eligibility remains unchanged', () => {
  assert.match(pickup, /Number\(order\.remainingBalancePYG\) !== 0/);
  assert.match(pickup, /delayed \? order\.status === 'PAID_IN_FULL' : order\.status === 'PAYMENT_CONFIRMED'/);
});
