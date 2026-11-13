import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const checkout = await readFile(new URL('../../../js/checkout.js', import.meta.url), 'utf8');
const site = await readFile(new URL('../../../js/site.js', import.meta.url), 'utf8');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const render = new Function(`
  const DELAYED_FINAL_PAYMENT_WINDOW = '1–8 diciembre 2026';
  ${between(site, 'function dueNowForProduct(', 'function stripLeadingSlash(')}
  ${site.slice(site.indexOf('function escapeHtml('))}
  ${between(checkout, 'function renderCheckoutSummary(', 'async function renderCheckoutPage(')}
  return renderCheckoutSummary;
`)();
const entry = (itemNumber, fields = {}, quantity = 1) => ({ quantity, product: {
  itemNumber, title: `Artículo ${itemNumber}`, askingPricePYG: 10800,
  saleMode: 'DELAYED', depositPercent: 25,
  pickupWindowStart: '2026-12-09', pickupWindowEnd: '2026-12-12', ...fields,
} });

test('checkout leads with supplied totals and retains frozen per-unit, quantity and deposit amounts', () => {
  const items = [entry(1, { askingPricePYG: 13151 }, 2), entry(2, { saleMode: 'IMMEDIATE', askingPricePYG: 6001 })];
  const before = structuredClone(items);
  const html = render(items, { total: 32303, dueNow: 12577, future: 19726 });
  assert.ok(html.indexOf('Valor total') < html.indexOf('Artículo 1'));
  for (const value of ['32.303', '12.577', '19.726', '13.151', '6.576', '6.001', 'Cantidad: 2', 'Seña 25%']) assert.ok(html.includes(value), value);
  assert.deepEqual(items, before);
});

test('identical dates appear once; pickup and deposit exceptions stay visible with their item identity', () => {
  const html = render([entry(405), entry(441, { pickupAvailableDate: '2026-12-09' }), entry(526, {
    depositPercent: 40, pickupWindowStart: '2026-12-11', pickupAvailableDate: '2026-12-12',
  })], { total: 32400, dueNow: 9720, future: 22680 });
  assert.equal(html.split('1–8 diciembre 2026').length - 1, 1);
  assert.equal(html.split('9–12 diciembre 2026').length - 1, 1);
  assert.match(html, /Ítem 405, Ítem 441/);
  assert.match(html, /Ítem 526/);
  assert.match(html, /11–12 diciembre 2026/);
  assert.match(html, /Desde 2026-12-12/);
  assert.match(html, /Seña 40%/);
});

test('fully paid immediate checkout has no final-payment notice and escapes names', () => {
  const html = render([entry(null, { title: '<script>bad</script>', saleMode: 'IMMEDIATE', pickupWindowStart: null, pickupWindowEnd: null })],
    { total: 10800, dueNow: 10800, future: 0 });
  assert.doesNotMatch(html, /Pago final|<script>|Retiro ·/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
});
