import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');
const instant = Date.parse('2026-10-28T15:04:05Z');
const tick = () => new Promise(setImmediate);
const json = (body, ok = true) => ({ ok, json: async () => body,
  headers: new Headers({ 'content-type': 'application/json' }) });
const order = (id, status = 'AWAITING_INITIAL_PAYMENT') => ({
  id, status, buyer: { name: `Cliente ${id}` }, createdAt: '2026-10-28T14:00:00Z', totals: { totalPYG: 50000 },
});

// Small DOM fixture for the existing renderers: controls retain their listeners,
// and replaceWith preserves the actual detail/panel node just as in the browser.
function scenario() {
  let now = instant;
  const calls = [];
  let respond = async () => json({ orders: [order('NEW')] });
  let nodes = [];
  let activeElement = null;
  const makeNode = (attrs = {}) => ({
    attrs, hidden: 'hidden' in attrs, disabled: false, textContent: '', innerHTML: '',
    value: attrs.value || '', listeners: {},
    classList: { toggle() {} },
    focus() { activeElement = this; },
    setSelectionRange(start, end, direction = 'none') {
      this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
    },
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    replaceWith(other) { nodes[nodes.indexOf(this)] = other; },
    fire(type, value = this.value, properties = {}) {
      this.value = value;
      return this.listeners[type]?.({ target: this, currentTarget: this, ...properties });
    },
  });
  const matches = (node, selector) => {
    if (selector.startsWith('#')) return node.attrs.id === selector.slice(1);
    if (selector.startsWith('.')) return (node.attrs.class || '').split(' ').includes(selector.slice(1));
    const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]/);
    return Boolean(match && match[1] in node.attrs &&
      (match[2] === undefined || node.attrs[match[1]] === match[2]) &&
      (!selector.includes(':not([hidden])') || !node.hidden));
  };
  const target = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(html) {
      this._html = html;
      if (nodes.includes(activeElement)) activeElement = null;
      nodes = [...html.matchAll(/<(?:input|select|button|div|p|section|strong)\b([^>]*)>/g)].map(([, tag]) => {
        const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
        for (const [name] of tag.matchAll(/\bdata-[\w-]+\b(?![\w-]|=)/g)) {
          if (!(name in attrs)) attrs[name] = '';
        }
        if (/\bhidden\b/.test(tag)) attrs.hidden = '';
        return makeNode(attrs);
      });
    },
    querySelector(selector) { return nodes.find(node => matches(node, selector)) || null; },
    querySelectorAll(selector) { return nodes.filter(node => matches(node, selector)); },
  };
  const badge = makeNode();
  const nav = ['orders', 'inventory'].map(tab => makeNode({ 'data-admin-tab': tab }));
  const context = {
    console, Headers, Intl, URL, CSS: { escape: String },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    window: { addEventListener() {} },
    document: {
      get activeElement() { return activeElement; },
      getElementById(id) { return id === 'admin-tab-content' ? target : target.querySelector(`#${id}`); },
      querySelector(selector) {
        if (selector === 'main') return target;
        if (selector === '[data-admin-tab="orders"] span') return badge;
        return target.querySelector(selector);
      },
      querySelectorAll(selector) { return selector === '[data-admin-tab]' ? nav : []; },
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/admin/legacy-reconciliation-review') return json({ queue: [] });
      if (url === '/api/admin/pickup') return json({ upcoming: [] });
      return respond(url, options);
    },
  };
  runInNewContext(`${source}\n;globalThis.api = { ADMIN_STATE, fetchAdminOrders, refreshAdminOrders,
    renderAdminTab, renderOrdersTab, renderInventoryTab,
    loadDashboard: async () => { renderAdminShell = () => {}; await loadAdminDashboard(); },
  };`, context);
  const api = context.api;
  Object.assign(api.ADMIN_STATE, { token: 'synthetic-admin', orders: [order('OLD')], activeTab: 'orders' });
  return { ...api, state: api.ADMIN_STATE, target, calls, badge,
    get activeElement() { return activeElement; },
    advance(ms) { now += ms; },
    respond(fn) { respond = fn; },
    enter(tab) { api.ADMIN_STATE.activeTab = tab; api.renderAdminTab(); },
    node(selector) { return target.querySelector(selector); },
  };
}

test('entering Pedidos refreshes once, skips recent loads, and refreshes again at 30 seconds', async () => {
  const s = scenario();
  s.enter('orders');
  await tick();
  assert.equal(s.calls.filter(c => c.url === '/api/admin/orders').length, 1);
  assert.equal(s.state.orders[0].id, 'NEW');
  assert.equal(s.state.ordersUpdatedAt, instant);
  const request = s.calls.find(c => c.url === '/api/admin/orders');
  assert.equal(request.options.headers['x-admin-token'], 'synthetic-admin');
  assert.equal(request.options.cache, 'no-store');
  s.advance(29999);
  s.enter('inventory'); s.enter('orders');
  await tick();
  assert.equal(s.calls.filter(c => c.url === '/api/admin/orders').length, 1);
  s.advance(1);
  s.enter('inventory'); s.enter('orders');
  await tick();
  assert.equal(s.calls.filter(c => c.url === '/api/admin/orders').length, 2);
});

test('initial dashboard order load records freshness so first entry does not fetch orders twice', async () => {
  const s = scenario();
  const products = [{ published: true, batchId: 'batch' }];
  s.respond(async url => json({
    '/api/admin/orders': { orders: [order('DASHBOARD')] },
    '/api/admin/legacy-inventory': { products, batches: [] },
    '/api/admin/buyer-groups': { buyerGroups: [] },
    '/api/admin/fulfillment-batches': { fulfillmentBatches: [] },
    '/api/admin/sale-pulse': { salePulse: null },
    '/api/admin/legacy-reconciliation-review': { queue: [] },
    '/api/admin/pickup': { upcoming: [] },
  }[url]));
  await s.loadDashboard();
  s.enter('orders');
  await tick();
  assert.equal(s.calls.filter(c => c.url === '/api/admin/orders').length, 1);
  assert.equal(s.state.ordersUpdatedAt, instant);
  assert.equal(s.state.stats.totalProducts, 1);
});

test('manual refresh bypasses freshness, retains open detail/panels and search/filter, and updates counts', async () => {
  const s = scenario();
  s.state.ordersUpdatedAt = instant;
  s.state.orderSearch = 'Cliente OLD';
  s.state.orderFilter = 'ALL';
  s.renderOrdersTab();
  const detail = s.node('[data-admin-detail="OLD"]');
  detail.hidden = false;
  detail.innerHTML = 'An open order with unsaved form data';
  const review = s.node('#admin-legacy-reconciliation-review');
  const pickups = s.node('#admin-upcoming-pickups');
  s.calls.length = 0;
  s.advance(1000);
  s.respond(async () => json({ orders: [order('OLD'), order('PAID', 'PAID_IN_FULL'), order('RECEIPT', 'RECEIPT_RECEIVED')] }));
  await s.node('#admin-refresh-orders').fire('click');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, '/api/admin/orders');
  assert.equal(s.state.orderSearch, 'Cliente OLD');
  assert.equal(s.state.orderFilter, 'ALL');
  assert.equal(s.node('[data-admin-detail="OLD"]'), detail);
  assert.equal(s.node('[data-admin-open="OLD"]').getAttribute('aria-expanded'), 'true');
  assert.equal(s.node('#admin-legacy-reconciliation-review'), review);
  assert.equal(s.node('#admin-upcoming-pickups'), pickups);
  assert.equal(s.state.stats.orderCount, 3);
  assert.equal(s.state.stats.awaitingPayment, 2);
  assert.equal(s.state.stats.confirmed, 1);
  assert.equal(s.badge.textContent, 2);
  assert.equal(s.state.ordersUpdatedAt, instant + 1000);
  assert.match(s.node('#admin-orders-updated').textContent, /12:04:06.*hora de Paraguay/);
  assert.equal(s.node('#admin-refresh-orders').disabled, false);
  assert.equal(s.node('#admin-orders-refresh-error').hidden, true);
});

test('rapid manual/tab loads share one in-flight request and do not navigate away on completion', async () => {
  const s = scenario();
  let finish;
  s.respond(() => new Promise(resolve => { finish = resolve; }));
  s.enter('orders');
  assert.equal(s.node('#admin-refresh-orders').disabled, true);
  assert.match(s.node('#admin-refresh-orders').textContent, /Actualizando/);
  const duplicate = s.node('#admin-refresh-orders').fire('click');
  s.enter('inventory'); s.enter('orders'); s.enter('inventory');
  const inventoryHTML = s.target.innerHTML;
  finish(json({ orders: [order('DONE')] }));
  await duplicate; await tick();
  assert.equal(s.calls.filter(c => c.url === '/api/admin/orders').length, 1);
  assert.equal(s.state.orders[0].id, 'DONE');
  assert.equal(s.state.activeTab, 'inventory');
  assert.equal(s.target.innerHTML, inventoryHTML);
  assert.equal(s.state.ordersRequest, null);
});

test('an existing post-action loader waits for a pending tab refresh then loads a new snapshot', async () => {
  const s = scenario();
  let finish;
  let requests = 0;
  s.respond(() => ++requests === 1
    ? new Promise(resolve => { finish = resolve; })
    : json({ orders: [order('AFTER-ACTION', 'PAID_IN_FULL')] }));
  const refreshing = s.refreshAdminOrders();
  const actionReload = s.fetchAdminOrders();
  assert.equal(requests, 1);
  finish(json({ orders: [order('BEFORE-ACTION')] }));
  await Promise.all([refreshing, actionReload]);
  assert.equal(requests, 2);
  assert.equal(s.state.orders[0].id, 'AFTER-ACTION');
  assert.equal(s.state.stats.confirmed, 1);
});

for (const failure of ['network', 'http', 'json', 'shape']) {
  test(`${failure} failure preserves orders, timestamp, counts and open detail; retry succeeds`, async () => {
    const s = scenario();
    s.state.ordersUpdatedAt = instant;
    s.state.stats = { orderCount: 1 };
    s.renderOrdersTab();
    const original = s.state.orders;
    const detail = s.node('[data-admin-detail="OLD"]');
    detail.hidden = false;
    const timestamp = s.node('#admin-orders-updated').textContent;
    s.respond(async () => {
      if (failure === 'network') throw new Error('offline');
      if (failure === 'http') return json({ error: 'unavailable' }, false);
      if (failure === 'json') return { json: async () => { throw new SyntaxError('bad json'); } };
      return json({ orders: {} });
    });
    await s.node('#admin-refresh-orders').fire('click');
    assert.equal(s.state.orders, original);
    assert.equal(s.state.ordersUpdatedAt, instant);
    assert.equal(s.state.stats.orderCount, 1);
    assert.equal(s.node('[data-admin-detail="OLD"]'), detail);
    assert.equal(s.node('#admin-orders-updated').textContent, timestamp);
    assert.equal(s.node('#admin-refresh-orders').disabled, false);
    assert.equal(s.node('#admin-orders-refresh-error').hidden, false);
    assert.match(s.node('#admin-orders-refresh-error').textContent, /No se pudieron actualizar.*Intentá nuevamente/);
    s.advance(1000);
    s.respond(async () => json({ orders: [] }));
    // A failure can be retried on entry even inside the freshness window.
    s.enter('orders'); await tick();
    assert.equal(s.state.orders.length, 0);
    assert.equal(s.state.ordersUpdatedAt, instant + 1000);
    assert.equal(s.node('#admin-orders-refresh-error').hidden, true);
  });
}

test('order search, state filters and open/close navigation still work after refresh', async () => {
  const s = scenario();
  s.respond(async () => json({ orders: [order('NEW'), order('CANCELLED', 'CANCELLED')] }));
  await s.refreshAdminOrders();
  assert.ok(s.node('[data-admin-open="NEW"]'));
  assert.equal(s.node('[data-admin-open="CANCELLED"]'), null);
  s.node('[data-admin-order-filter="CANCELLED"]').fire('click');
  assert.ok(s.node('[data-admin-open="CANCELLED"]'));
  s.node('[data-admin-order-search]').fire('input', 'Cliente NEW');
  assert.ok(s.node('[data-admin-open="NEW"]'));
  assert.equal(s.state.orderFilter, 'CANCELLED');
  s.respond(async () => json({ order: order('NEW') }));
  await s.node('[data-admin-open="NEW"]').fire('click'); await tick();
  assert.equal(s.calls.at(-1).url, '/api/admin/order?id=NEW');
  assert.equal(s.node('[data-admin-open="NEW"]').getAttribute('aria-expanded'), 'true');
  assert.match(s.node('[data-admin-detail="NEW"]').innerHTML, /1\. Pedido y comprador/);
  s.node('[data-admin-open="NEW"]').fire('click');
  assert.equal(s.node('[data-admin-open="NEW"]').getAttribute('aria-expanded'), 'false');
  assert.equal(s.node('[data-admin-detail="NEW"]').hidden, true);
});

function inventoryFixture() {
  const item = (id, overrides = {}) => ({ id, itemNumber: id, title: `Artículo ${id}`, batchId: 'ONE',
    published: true, status: 'SOLD', quantityRemaining: 0,
    live: { status: 'AVAILABLE', quantityRemaining: 1 }, ...overrides });
  return [
    item(1), item(2, { live: { status: 'AVAILABLE', quantityRemaining: '2' } }),
    item(3, { live: { status: 'SOLD', quantityRemaining: 2 } }),
    item(4, { live: { status: 'PICKED_UP', quantityRemaining: 2 } }),
    item(5, { published: false }), item(6, { live: { status: 'AVAILABLE', quantityRemaining: 0 } }),
    item(7, { live: { status: 'AVAILABLE', quantityRemaining: -1 } }),
    item(8, { live: { status: 'NEEDS_REVIEW', quantityRemaining: 1 } }),
    item(9, { live: null }), item(10, { live: { status: 'AVAILABLE' } }),
    item(11, { live: { status: 'RESERVED', quantityRemaining: 1 } }),
    item(12, { batchId: 'TWO' }),
  ];
}

test('Activos defaults to published live AVAILABLE with positive remaining quantity without changing inventory', () => {
  const s = scenario();
  s.state.inventory = inventoryFixture();
  const original = JSON.stringify(s.state.inventory);
  assert.equal(s.state.inventoryStatus, 'ACTIVE');
  s.enter('inventory');
  const rows = [...s.target.innerHTML.matchAll(/data-legacy-open="([^"]+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(rows, [1, 2, 12]);
  assert.match(s.target.innerHTML, /value="ACTIVE" selected/);
  assert.equal(JSON.stringify(s.state.inventory), original);
  assert.equal(s.calls.length, 0);
});

test('inventory retains Todos/Publicados/Pendientes, search, batch and publication selection across tabs', () => {
  const s = scenario();
  s.state.inventory = inventoryFixture();
  s.state.batches = [{ id: 'ONE', name: 'Uno' }, { id: 'TWO', name: 'Dos' }];
  s.state.ordersUpdatedAt = instant;
  s.enter('inventory');
  for (const [status, count] of [['ALL', 12], ['PUBLISHED', 11], ['REVIEW', 1], ['ACTIVE', 3]]) {
    s.node('#inventory-status').fire('change', status);
    assert.equal((s.target.innerHTML.match(/data-legacy-open=/g) || []).length, count);
  }
  s.node('#inventory-batch').fire('change', 'TWO');
  s.node('#inventory-search').fire('input', 'Artículo 12');
  assert.equal((s.target.innerHTML.match(/data-legacy-open=/g) || []).length, 1);
  s.node('#inventory-status').fire('change', 'ALL');
  s.enter('orders'); s.enter('inventory');
  assert.equal(s.state.inventoryStatus, 'ALL');
  assert.equal(s.state.inventoryBatch, 'TWO');
  assert.equal(s.state.inventorySearch, 'Artículo 12');
  assert.equal((s.target.innerHTML.match(/data-legacy-open=/g) || []).length, 1);
  assert.match(s.target.innerHTML, /value="ALL"\s+selected/);
  assert.match(s.target.innerHTML, /value="TWO"\s+selected/);
});

test('inventory continuous typing retains the same focused input, caret and filters while updating matches/count', () => {
  const s = scenario();
  s.state.inventory = inventoryFixture();
  s.enter('inventory');
  const input = s.node('#inventory-search');
  const batch = s.node('#inventory-batch'), status = s.node('#inventory-status');
  input.focus();
  let value = '';
  for (const character of 'Artículo 12') {
    value += character;
    input.setSelectionRange(value.length, value.length);
    input.fire('input', value);
    assert.equal(s.node('#inventory-search'), input);
    assert.equal(s.activeElement, input);
    assert.equal(input.selectionStart, value.length);
    assert.equal(input.selectionEnd, value.length);
    assert.equal(s.state.inventorySearch, value);
    assert.equal(s.node('#inventory-batch'), batch);
    assert.equal(s.node('#inventory-status'), status);
    const expected = value === 'Artículo 12' ? 1 : value === 'Artículo 1' ? 2 : 3;
    assert.equal(s.node('#inventory-count').textContent, `${expected} de 12`);
    assert.equal((s.node('#inventory-results').innerHTML.match(/data-legacy-open=/g) || []).length, expected);
  }
  assert.equal(s.calls.length, 0);
});

test('inventory middle edits, deletion, replacement, clearing and composition preserve focus and selection', () => {
  const s = scenario();
  s.state.inventory = inventoryFixture();
  s.enter('inventory');
  const input = s.node('#inventory-search');
  input.focus();
  // Each input event arrives after the browser has applied the edit and caret movement.
  for (const [value, start, end, direction, isComposing = false] of [
    ['Artículo 12', 11, 11, 'none'],
    ['ArtXículo 12', 4, 4, 'none'], // Insert in the middle.
    ['Artículo 12', 3, 3, 'none'], // Backspace.
    ['Artculo 12', 3, 3, 'none'], // Delete.
    ['Artículo 12', 3, 5, 'backward'], // Selection survives an input update.
    ['ArtABulo 12', 5, 5, 'none'], // Replace selected text.
    ['', 0, 0, 'none'], // Clear, including the native search clear action.
    ['に', 1, 1, 'none', true],
    ['日本', 0, 2, 'backward', true],
    ['日本', 2, 2, 'none'],
    ['', 0, 0, 'none'],
  ]) {
    input.setSelectionRange(start, end, direction);
    input.fire('input', value, { isComposing });
    assert.equal(s.node('#inventory-search'), input);
    assert.equal(s.activeElement, input);
    assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [start, end, direction]);
    assert.equal(s.state.inventorySearch, value);
    if (value === '') assert.equal(s.node('#inventory-count').textContent, '3 de 12');
    if (isComposing) assert.match(s.node('#inventory-results').innerHTML, /No encontramos artículos/);
  }
});

test('inventory search updates honor every publication view and batch without mutating inventory', () => {
  const s = scenario();
  s.state.inventory = inventoryFixture();
  s.state.batches = [{ id: 'ONE', name: 'Uno' }, { id: 'TWO', name: 'Dos' }];
  const before = JSON.stringify(s.state.inventory);
  s.enter('inventory');
  s.node('#inventory-batch').fire('change', 'ONE');
  for (const [status, count] of [['ACTIVE', 2], ['ALL', 11], ['PUBLISHED', 10], ['REVIEW', 1]]) {
    s.node('#inventory-status').fire('change', status);
    s.node('#inventory-search').fire('input', 'Artículo');
    assert.equal(s.node('#inventory-count').textContent, `${count} de 12`);
    assert.equal((s.node('#inventory-results').innerHTML.match(/data-legacy-open=/g) || []).length, count);
    assert.equal(s.state.inventoryBatch, 'ONE');
    assert.equal(s.state.inventoryStatus, status);
    s.node('#inventory-search').fire('input', 'no match');
    assert.equal(s.node('#inventory-count').textContent, '0 de 12');
    assert.match(s.node('#inventory-results').innerHTML, /No encontramos artículos/);
    s.node('#inventory-search').fire('input', '');
    assert.equal(s.node('#inventory-count').textContent, `${count} de 12`);
  }
  assert.equal(JSON.stringify(s.state.inventory), before);
  assert.equal(s.calls.length, 0);
});

test('opening inventory and returning from another tab never focus search automatically', () => {
  const s = scenario();
  s.badge.focus();
  s.enter('inventory');
  assert.equal(s.activeElement, s.badge);
  s.node('#inventory-search').focus();
  s.node('#inventory-search').fire('input', 'saved search');
  s.enter('review');
  s.badge.focus();
  s.enter('inventory');
  assert.equal(s.activeElement, s.badge);
  assert.equal(s.node('#inventory-search').value, 'saved search');
});
