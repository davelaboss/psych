import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { liquidationPrice, cartPricingSnapshot, withCartPricing } from './liquidation.mjs';

const read = path => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const [site, storefront, checkout, shell] = await Promise.all(
  ['js/site.js', 'js/volume2-storefront.js', 'js/checkout.js', 'index.html'].map(read),
);

function renderers(quantity = 1) {
  const main = { innerHTML: '' };
  const strip = { hidden: true };
  const classes = { add() {}, remove() {}, toggle() {} };
  const document = {
    readyState: 'loading', addEventListener() {}, removeEventListener() {},
    documentElement: { classList: classes }, body: { classList: classes, dataset: {} },
    querySelector: selector => selector === 'main' ? main
      : selector === '[data-liquidation-announcement]' ? strip : null,
    querySelectorAll: () => [], getElementById: () => null,
    createElement: () => ({ dataset: {} }),
  };
  const window = {
    location: { pathname: '/' }, addEventListener() {}, dispatchEvent() {},
    imageDelivery: { resolve: x => x, original: x => x },
  };
  const context = { document, window, URL, CustomEvent: class {},
    localStorage: { getItem: () => JSON.stringify({ ids: ['item-605'], quantities: { 'item-605': quantity } }) },
    fetch: async () => ({ ok: true, json: async () => ({ liquidationActive: true }) }),
  };
  // Exercise real renderers without starting background cart synchronization.
  runInNewContext(site.replace('syncStaticCartFromServer({ migrateLegacy: true })', 'Promise.resolve()') +
    '\nglobalThis.ui = {renderProductDetail, renderCartItem, renderLiquidationPrice, setupLiquidationAnnouncement};', context);
  runInNewContext(storefront.replace(/\}\)\(\);\s*$/, 'globalThis.card = renderCard;\n})();'), context);
  runInNewContext(checkout + '\nglobalThis.summary = renderCheckoutSummary;', context);
  return { ...context, main, strip };
}

const product = (itemNumber, askingPricePYG, extra = {}) => ({
  id: `item-${itemNumber}`, itemNumber, slug: `item-${itemNumber}`, title: `Artículo ${itemNumber}`,
  status: 'AVAILABLE', currency: 'PYG', askingPricePYG, quantityRemaining: 3, quantityTotal: 3,
  saleMode: 'DELAYED', depositPercent: 25, pickupWindowStart: '2026-12-09', pickupWindowEnd: '2026-12-12',
  ...extra,
});

test('catalog, detail, cart and checkout render the same 80% offer, quantities, deposit and dates', () => {
  const ui = renderers(2);
  const delayed = liquidationPrice(product(605, 195000), undefined, true);
  const immediate = liquidationPrice(product(592, 4000, { saleMode: 'IMMEDIATE', depositPercent: 100 }), undefined, true);
  const before = structuredClone(delayed);
  const card = ui.card(delayed).innerHTML;
  ui.ui.renderProductDetail(delayed);
  for (const html of [card, ui.main.innerHTML]) {
    assert.match(html, /195\.000/);
    assert.match(html, /39\.000/);
    assert.match(html, /−80%/);
  }
  for (const value of ['9.750', '29.250', '1–8 diciembre 2026', '9–12 diciembre 2026']) {
    assert.ok(ui.main.innerHTML.includes(value), value);
  }
  const cart = ui.ui.renderCartItem(delayed);
  for (const value of ['39.000', '19.500', '58.500', '1–8 diciembre 2026', '9–12 diciembre 2026']) {
    assert.ok(cart.includes(value), value);
  }
  assert.match(cart, /value="2"\s+selected/);
  assert.match(ui.card(immediate).innerHTML, /−10%/);
  const summary = ui.summary([{ product: delayed, quantity: 2 }, { product: immediate, quantity: 1 }],
    { total: 81600, dueNow: 23100, future: 58500 });
  for (const value of ['81.600', '23.100', '58.500', '39.000', '3.600', 'Seña 25%', '1–8 diciembre 2026', '9–12 diciembre 2026']) {
    assert.ok(summary.includes(value), value);
  }
  assert.deepEqual(delayed, before);
});

test('accepted 50% prices remain visible and exemptions never receive campaign badges', () => {
  const ui = renderers();
  const p = product(605, 195000);
  const accepted = withCartPricing(p, cartPricingSnapshot({ ...p, askingPricePYG: 97500,
    liquidation: { id: 'moving-sale-final-2026-11-13', originalAskingPricePYG: 195000, percent: 50 } }));
  assert.match(ui.card(accepted).innerHTML, /97\.500/);
  assert.match(ui.card(accepted).innerHTML, /−50%/);
  for (const p of [product(313, 1800000), product(615, null, { currency: 'USD', askingPriceUSD: 16990, saleMode: 'INQUIRY' })]) {
    const html = ui.card(liquidationPrice(p, undefined, true)).innerHTML;
    assert.doesNotMatch(html, /liquidation-badge/);
    assert.match(html, p.itemNumber === 313 ? /1\.800\.000/ : /US\$16,990/);
  }
});

test('shared announcement uses Hasta 80% OFF on home, product, cart, checkout and private order routes', async () => {
  assert.match(shell, /data-liquidation-announcement[^>]*hidden>.*Hasta 80% OFF/);
  const ui = renderers();
  for (const path of ['/', '/producto/item-605', '/carrito', '/checkout', '/pedido/accepted-order']) {
    ui.strip.hidden = true;
    ui.window.location.pathname = path;
    await ui.ui.setupLiquidationAnnouncement();
    assert.equal(ui.strip.hidden, false, path);
  }
});
