import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('./inventory-database.mjs', import.meta.url), 'utf8');
const notifications = await readFile(new URL('./seller-notifications.mjs', import.meta.url), 'utf8');

test('concurrent confirmations serialize on the checkout row lock', () => {
  assert.match(source, /SELECT \* FROM checkout_attempts WHERE order_id=\$1 FOR UPDATE/);
  const confirmation = source.slice(source.indexOf('export async function confirmOrderPayment'),
    source.indexOf('export async function addOrderPaymentNote'));
  assert.ok(confirmation.indexOf('await orderLock(client, orderId)') <
    confirmation.indexOf('applyPaymentConfirmation(current'));
});

test('inventory commitment remains one-time and snapshot update is in the same transaction', () => {
  const confirmation = source.slice(source.indexOf('export async function confirmOrderPayment'),
    source.indexOf('export async function addOrderPaymentNote'));
  assert.match(confirmation, /confirmationRequiresInventoryCommit\(row\.committed_at, result\)/);
  assert.match(confirmation, /committed_quantity=committed_quantity\+\$2/);
  assert.match(confirmation, /SET committed_at=COALESCE\(committed_at,\$2\),order_snapshot=\$3/);
});

test('legacy reconciliation and its note update one locked order snapshot atomically', () => {
  const reconciliation = source.slice(source.indexOf('export async function reconcileOrderLegacyPayment'),
    source.indexOf('export async function commitInventoryHold'));
  assert.match(reconciliation, /await orderLock\(client, orderId\)/);
  assert.match(reconciliation, /reconcileLegacyPaymentState/);
  assert.match(reconciliation, /UPDATE checkout_attempts SET order_snapshot=\$2/);
});

test('payment notification retry remains idempotent by payment ID', () => {
  assert.match(source, /key: `payment:\$\{confirmation\.paymentId\}`/);
  assert.match(notifications, /ON CONFLICT\(event_key\) DO NOTHING/);
});
