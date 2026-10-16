import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const checkout = await readFile(new URL('../../../js/checkout.js', import.meta.url), 'utf8');
const redirects = await readFile(new URL('../../../_redirects', import.meta.url), 'utf8');

function between(source, start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

const display = between(checkout, 'function displayOrder(', 'async function setupPickupScheduler');
const activeMarkupStart = display.lastIndexOf('main.innerHTML = `');
const activeMarkup = display.slice(
  activeMarkupStart,
  display.indexOf('injectCheckoutStyles();', activeMarkupStart)
);

test('desktop hierarchy is header, status, order deadline, balanced items/payment grid, pickup, and lower help', () => {
  assert.ok(activeMarkup.indexOf('page-heading') < activeMarkup.indexOf('order-status-card'));
  assert.ok(activeMarkup.indexOf('order-status-card') < activeMarkup.indexOf('reservation-deadline-card'));
  assert.ok(activeMarkup.indexOf('reservation-deadline-card') < activeMarkup.indexOf('checkout-grid'));
  assert.ok(activeMarkup.indexOf('checkout-grid') < activeMarkup.indexOf('pickup-scheduler'));
  assert.ok(activeMarkup.indexOf('pickup-scheduler') < activeMarkup.indexOf('order-lower-actions'));
  assert.match(checkout, /grid-template-areas: "items payment"/);
  assert.match(checkout, /grid-template-columns:\s*minmax\(0, 1\.5fr\)\s*minmax\(280px, \.75fr\)/);
  assert.match(checkout, /align-items: start/);
});

test('mobile DOM and grid reading order prioritize payment before items without horizontal overflow', () => {
  assert.ok(activeMarkup.indexOf('order-payment-section') < activeMarkup.indexOf('order-items-section'));
  assert.match(checkout, /grid-template-areas:\s*"payment"\s*"items"/);
  assert.match(checkout, /\.order-payment-section[\s\S]*?min-width: 0/);
  assert.match(checkout, /\.order-items-section[\s\S]*?min-width: 0/);
  assert.match(checkout, /width: min\(520px, calc\(100% - 32px\)\)/);
  assert.match(checkout, /\.cancel-order-dialog \{[\s\S]*?margin: auto/);
});

test('oversized top final-sale policy is removed and one compact reminder remains below WhatsApp', () => {
  assert.doesNotMatch(checkout, /Todas las ventas son finales\./);
  assert.doesNotMatch(checkout, /final-sale-policy/);
  assert.equal((checkout.match(/Recordatorio: Revisá los artículos al retirarlos/g) || []).length, 1);
  assert.ok(activeMarkup.indexOf('order-lower-actions') < activeMarkup.indexOf('order-policy-reminder'));
  const pickup = between(checkout, 'async function setupPickupScheduler', 'function renderCustomerFinancialSummary');
  assert.doesNotMatch(pickup, /pickup-policy-reminder/);
});

test('eligible unpaid order has subordinate cancellation with an accessible safe-first dialog', () => {
  assert.match(display, /customerCancellationEligible = awaitingInitialPayment && !order\.receipt/);
  assert.match(display, /class="destructive-secondary-action" id="cancel-order-trigger"/);
  assert.match(display, /<dialog class="cancel-order-dialog"/);
  assert.match(display, /aria-labelledby="cancel-order-title"/);
  assert.match(display, /aria-describedby="cancel-order-description cancel-order-transfer-warning"/);
  assert.match(display, /¿Cancelar este pedido\?/);
  assert.match(display, /Los artículos se liberarán inmediatamente y podrán ser comprados por otra persona\./);
  assert.match(display, /Si ya realizaste una transferencia, no canceles el pedido desde aquí\. Contactanos por WhatsApp\./);
  assert.match(display, /class="primary-action" id="keep-order-button" type="button" autofocus>No, mantener pedido/);
  assert.match(display, /class="destructive-action" id="confirm-cancel-order"[^>]*>Sí, cancelar pedido/);
});

test('safe action closes without a request while destructive action POSTs the private pair and rerenders', () => {
  const setup = between(checkout, 'function setupCustomerCancellation', 'async function setupPickupScheduler');
  assert.match(setup, /keepOrder\.addEventListener\('click', \(\) => dialog\.close\(\)\)/);
  assert.match(setup, /dialog\.addEventListener\('close', \(\) => trigger\.focus\(\)\)/);
  assert.match(setup, /fetch\('\/api\/orders\/cancel'/);
  assert.match(setup, /method: 'POST'/);
  assert.match(setup, /JSON\.stringify\(\{ orderId: order\.id, access \}\)/);
  assert.match(setup, /displayOrder\(result\.order, access\)/);
  assert.doesNotMatch(setup, /backdrop|event\.target === dialog/);
  assert.match(redirects, /\/api\/orders\/cancel\s+\/\.netlify\/functions\/customer-cancel-order/);
});

test('payment-started states remove one-click cancellation and point to WhatsApp', () => {
  assert.match(display, /paymentActivityStarted = Boolean\(order\.receipt\)/);
  assert.match(display, /\['RECEIPT_RECEIVED', 'VERIFYING_PAYMENT', 'FINAL_RECEIPT_RECEIVED'/);
  assert.match(display, /\$\{customerCancellationEligible \? `/);
  assert.match(display, /¿Necesitás cancelar\? <a[^>]+>Contactanos por WhatsApp\.<\/a>/);
});

test('cancelled customer, admin, and legacy orders use actor-aware wording and no active controls', () => {
  assert.match(display, /order\.cancelledBy === 'CUSTOMER'/);
  assert.match(display, /Cancelaste este pedido\. Los artículos fueron liberados y ya no están reservados para vos\./);
  assert.match(display, /order\.cancelledBy === 'ADMIN'/);
  assert.match(display, /Este pedido fue cancelado por el vendedor\./);
  assert.match(display, /Este pedido fue cancelado\. Los artículos ya no están reservados para este pedido\./);
  const cancelled = between(display, "if (order.status === 'CANCELLED')", 'const payments = order.payments');
  assert.match(cancelled, /No realices una transferencia/);
  assert.match(cancelled, /Volver al catálogo/);
  assert.match(cancelled, /Consultar por WhatsApp/);
  assert.doesNotMatch(cancelled, /receipt-form|pickup-scheduler|reservation-deadline-card|Datos para transferencia/);
});

test('payment, receipt, mixed fulfillment, pickup, and CART reservation paths remain present', () => {
  assert.match(checkout, /renderBankSection\(/);
  assert.match(checkout, /setupReceiptUpload\(/);
  assert.match(checkout, /order\.fulfillments/);
  assert.match(checkout, /setupPickupScheduler\(/);
  assert.match(checkout, /data-pickup-timing-key/);
  assert.match(checkout, /startCheckoutLeaseCountdown\(/);
  assert.match(checkout, /startCartReservationCountdown\(cart\.expiresAt\)/);
});
