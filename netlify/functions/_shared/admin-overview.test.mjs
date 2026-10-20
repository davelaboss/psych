import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const adminSource = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');

function pulse(overrides = {}) {
  return {
    tracking: {
      generatedAt: '2026-10-14T15:00:00.000Z',
      startedAt: '2026-10-13T15:00:00.000Z',
      historyWarning: '',
    },
    last24Hours: {},
    last7Days: {},
    inventory: {},
    operations: {},
    sources: {},
    productSignals: {},
    marketingBrief: 'Informe diario',
    ...overrides,
  };
}

function overviewScenario({
  stats = {}, orders = [], salePulse = pulse(), writeClipboard = async () => {},
  writeClipboardItem, fetchSalePulse = async () => pulse(),
} = {}) {
  const listeners = [];
  const target = {
    innerHTML: '',
    querySelector(selector) {
      if (!this.innerHTML.includes(selector.replace(/[\[\]]/g, ''))) return null;
      return {
        addEventListener(type, listener) { listeners.push({ selector, type, listener }); },
      };
    },
    querySelectorAll(selector) {
      if (selector === '[data-go-tab]') {
        return [...this.innerHTML.matchAll(/data-go-tab="([^"]+)"/g)].map((match) => ({
          addEventListener(type, listener) {
            listeners.push({ selector: `[data-go-tab="${match[1]}"]`, type, listener });
          },
          getAttribute(name) { return name === 'data-go-tab' ? match[1] : null; },
        }));
      }
      if (selector === '[data-priority-order]') {
        return [...this.innerHTML.matchAll(/data-priority-order="([^"]+)"/g)].map((match) => ({
          addEventListener(type, listener) {
            listeners.push({ selector: `[data-priority-order="${match[1]}"]`, type, listener });
          },
          getAttribute(name) { return name === 'data-priority-order' ? match[1] : null; },
        }));
      }
      return [];
    },
  };
  const context = {
    Blob,
    console,
    document: {
      getElementById(id) { return id === 'admin-tab-content' ? target : null; },
    },
    Intl,
    Headers,
    URL,
    fetch: async (url, options) => {
      const value = await fetchSalePulse(url, options);
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ salePulse: value }),
      };
    },
    navigator: { clipboard: {
      writeText: writeClipboard,
      ...(writeClipboardItem ? { write: writeClipboardItem } : {}),
    } },
    setTimeout,
    window: { addEventListener() {}, location: { pathname: '/admin' } },
  };
  if (writeClipboardItem) {
    context.ClipboardItem = class ClipboardItem {
      constructor(data) { this.data = data; }
    };
  }
  runInNewContext(`${adminSource}\n;globalThis.__adminOverview = { ADMIN_STATE, renderOverviewTab };`, context);
  Object.assign(context.__adminOverview.ADMIN_STATE, {
    stats: {
      totalProducts: 305,
      published: 299,
      sourceDrift: 0,
      review: 0,
      volume2: 101,
      initial: 204,
      orderCount: 12,
      awaitingPayment: 0,
      ...stats,
    },
    orders,
    salePulse,
    salePulseLoading: false,
    salePulseError: '',
    token: 'secret-admin-token',
  });
  context.__adminOverview.renderOverviewTab();
  return { html: target.innerHTML, listeners, state: context.__adminOverview.ADMIN_STATE };
}

test('Resumen puts Sale Pulse before collapsed technical information', () => {
  const { html } = overviewScenario();
  assert.ok(html.indexOf('PULSO DE VENTA') < html.indexOf('Información técnica'));
  assert.match(html, /<details class="admin-technical-details">/);
  assert.doesNotMatch(html, /<details class="admin-technical-details" open/);
});

test('zero exceptions do not render an action section or empty payment panel', () => {
  const { html } = overviewScenario();
  assert.doesNotMatch(html, /ATENCIÓN OPERATIVA/);
  assert.doesNotMatch(html, /Pagos por confirmar/);
  assert.doesNotMatch(html, /No hay pagos pendientes de revisión/);
});

test('qualifying payments render priority orders with order navigation intact', () => {
  const { html, listeners } = overviewScenario({
    stats: { awaitingPayment: 1 },
    orders: [{
      id: 'ORDER-123',
      status: 'RECEIPT_RECEIVED',
      buyer: { name: 'Comprador' },
      totals: { dueNowPYG: 50000 },
    }],
  });
  assert.match(html, /ATENCIÓN OPERATIVA/);
  assert.match(html, /Pagos por confirmar/);
  assert.match(html, /data-priority-order="ORDER-123"/);
  assert.ok(listeners.some(({ selector, type }) =>
    selector === '[data-priority-order="ORDER-123"]' && type === 'click'));
});

test('review and source drift exceptions render only when nonzero', () => {
  const quiet = overviewScenario().html;
  assert.doesNotMatch(quiet, /Pendientes de revisión/);
  assert.doesNotMatch(quiet, /Fuente ≠ producción/);

  const active = overviewScenario({ stats: { review: 2, sourceDrift: 1 } }).html;
  assert.match(active, /Pendientes de revisión/);
  assert.match(active, /data-go-tab="review"/);
  assert.match(active, /Fuente ≠ producción/);
  assert.match(active, /no se sincroniza automáticamente/);
  assert.match(active, /data-go-tab="inventory"/);
});

test('pickup exceptions are compact and Sale Pulse controls remain available', () => {
  const { html, listeners } = overviewScenario({
    salePulse: pulse({
      operations: {
        eligiblePickupsUnscheduled: 2,
        scheduledPickupsPending: 1,
      },
    }),
  });
  assert.match(html, /Retiros sin horario/);
  assert.match(html, /Retiros programados pendientes/);
  assert.match(html, /data-refresh-sale-pulse/);
  assert.match(html, /data-copy-sale-pulse/);
  assert.ok(listeners.some(({ selector, type }) =>
    selector === '[data-refresh-sale-pulse]' && type === 'click'));
  assert.ok(listeners.some(({ selector, type }) =>
    selector === '[data-copy-sale-pulse]' && type === 'click'));
});

test('Resumen displays marketability counts and copies readable packet JSON independently of the report', async () => {
  const packet = {
    generatedAt: '2026-10-18T15:00:00Z',
    marketabilitySummary: { marketable: 10, temporarilyReserved: 2, pendingPaymentOrConfirmation: 3, sold: 4, notMarketable: 5 },
    marketableProducts: [{ productId: 'product-1', title: 'Mesa' }],
  };
  const copied = [];
  const { html, listeners } = overviewScenario({
    salePulse: pulse({ marketingPacket: packet }),
    writeClipboard: async (text) => copied.push(text),
  });
  assert.match(html, /Disponibilidad actual para marketing/);
  assert.match(html, /Comercializables <strong>10/);
  assert.match(html, /Reserva temporal <strong>2/);
  assert.match(html, /Pago o confirmación pendiente <strong>3/);
  assert.match(html, /Vendidos \/ no comercializables <strong>9/);
  const button = { disabled: false, textContent: '' };
  await listeners.find(({ selector }) => selector === '[data-copy-sale-pulse-packet]').listener({ currentTarget: button });
  assert.deepEqual(JSON.parse(copied[0]), packet);
  assert.match(copied[0], /\n  "generatedAt"/);
  assert.equal(button.textContent, 'PAQUETE COPIADO');
  assert.equal(button.disabled, false);
  await listeners.find(({ selector }) => selector === '[data-copy-sale-pulse]').listener({ currentTarget: button });
  assert.equal(copied[1], 'Informe diario');
});

test('packet clipboard failure gives feedback and permits retry', async () => {
  const { listeners } = overviewScenario({
    salePulse: pulse({ marketingPacket: { marketabilitySummary: {} } }),
    writeClipboard: async () => { throw new Error('clipboard unavailable'); },
  });
  const button = { disabled: false, textContent: '' };
  await listeners.find(({ selector }) => selector === '[data-copy-sale-pulse-packet]').listener({ currentTarget: button });
  assert.equal(button.textContent, 'NO SE PUDO COPIAR');
  assert.equal(button.disabled, false);
});

const handoffPacket = {
  schemaVersion: 1,
  generatedAt: '2026-10-20T15:00:00Z',
  marketabilitySummary: { marketable: 1, sold: 1 },
  products: [
    { itemNumber: 34, title: 'Mesa actual', marketabilityStatus: 'MARKETABLE' },
    { itemNumber: 35, title: 'Artículo vendido', marketabilityStatus: 'SOLD' },
  ],
  marketableProducts: [{
    productId: 'product-34', itemNumber: 34, title: 'Mesa actual', askingPricePYG: 189000,
    purchasableQuantity: 2, productUrl: '/producto/mesa-actual?ref=catalogo',
    mainImage: '/assets/media/mesa-actual.jpg', marketabilityStatus: 'MARKETABLE',
  }],
  signalLists: { hotUnsold: ['product-34'] },
};

function chatgptButton(listeners) {
  return listeners.find(({ selector }) => selector === '[data-copy-sale-pulse-chatgpt]').listener;
}

test('ChatGPT button preserves both existing copy controls and uses mobile full-width layout', () => {
  const { html, listeners } = overviewScenario({ salePulse: pulse({ marketingPacket: handoffPacket }) });
  assert.match(html, /data-copy-sale-pulse>COPIAR INFORME PARA MARKETING/);
  assert.match(html, /data-copy-sale-pulse-packet[^>]*>COPIAR PAQUETE PARA MARKETING/);
  assert.match(html, /data-copy-sale-pulse-chatgpt>COPIAR PARA CHATGPT/);
  assert.equal(typeof chatgptButton(listeners), 'function');
  assert.match(adminSource, /@media \(max-width: 620px\)[\s\S]*?\.sale-pulse-heading button, \.sale-pulse-copy button \{ width: 100%; \}/);
});

test('ChatGPT handoff fetches fresh authenticated Sale Pulse and copies complete safe instructions', async () => {
  const requests = [];
  const copied = [];
  const fresh = pulse({ marketingPacket: handoffPacket });
  const { listeners, state } = overviewScenario({
    salePulse: pulse({ marketingPacket: { marketableProducts: [{ title: 'STALE PRODUCT' }] } }),
    fetchSalePulse: async (url, options) => { requests.push({ url, options }); return fresh; },
    writeClipboardItem: async ([item]) => copied.push(await (await item.data['text/plain']).text()),
  });
  const button = { disabled: false, textContent: '' };
  await chatgptButton(listeners)({ currentTarget: button });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/admin/sale-pulse');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.headers.get('x-admin-token'), 'secret-admin-token');
  assert.equal(state.salePulse, fresh);
  assert.equal(copied.length, 1);
  assert.doesNotMatch(copied[0], /STALE PRODUCT|secret-admin-token|x-admin-token|cookie|session ID|receipt|bank/i);
  assert.match(copied[0], /drive\.google\.com\/drive\/folders\/13qE2dHUjJBr1TOBUX7omaWr7r1k2nfct/);
  assert.match(copied[0], /autoridad FINAL/);
  assert.match(copied[0], /Item 034/);
  assert.match(copied[0], /marketingPacket\.marketableProducts/);
  assert.match(copied[0], /10 Items únicos: 5 para David y 5 para María/);
  assert.match(copied[0], /Para David, propone un collage de 3 productos y otro de 2\. Para María, uno de 3 y otro de 2/);
  assert.match(copied[0], /San Lorenzo, Barrio Santo Tomás, Paraguay/);
  assert.match(copied[0], /Sin entrega/);
  assert.match(copied[0], /1 al 8 de diciembre de 2026/);
  assert.match(copied[0], /9 al 12 de diciembre de 2026/);
  assert.match(copied[0], /No publiques automáticamente/);
  const links = JSON.parse(copied[0].split('REFERENCIAS DE ENLACES E IMÁGENES PARA PRODUCTOS COMERCIALIZABLES\n')[1].split('\n\nPAQUETE SALE PULSE ACTUAL COMPLETO')[0]);
  assert.equal(links.length, 1);
  assert.equal(links[0].productUrl, 'https://thelabossieres.com/producto/mesa-actual?ref=catalogo');
  assert.equal(links[0].imageUrl, 'https://thelabossieres.com/assets/media/mesa-actual.jpg');
  assert.equal(links[0].storyUrl, 'https://thelabossieres.com/producto/mesa-actual?ref=catalogo&src=story');
  assert.equal(links[0].whatsappGroupUrl, 'https://thelabossieres.com/producto/mesa-actual?ref=catalogo&src=jw-group');
  assert.deepEqual(JSON.parse(copied[0].split('PAQUETE SALE PULSE ACTUAL COMPLETO (marketingPacket)\n')[1]), handoffPacket);
  assert.equal(button.textContent, 'PROMPT COPIADO PARA CHATGPT');
  assert.equal(button.disabled, false);
});

test('fresh Sale Pulse failure copies nothing stale and retries successfully', async () => {
  let calls = 0;
  const copied = [];
  const { listeners } = overviewScenario({
    salePulse: pulse({ marketingPacket: handoffPacket }),
    fetchSalePulse: async () => {
      calls += 1;
      if (calls === 1) throw new Error('Network down');
      return pulse({ marketingPacket: handoffPacket });
    },
    writeClipboardItem: async ([item]) => copied.push(await (await item.data['text/plain']).text()),
  });
  const button = { disabled: false, textContent: '' };
  await chatgptButton(listeners)({ currentTarget: button });
  assert.equal(copied.length, 0);
  assert.equal(button.textContent, 'NO SE PUDO ACTUALIZAR · REINTENTAR');
  assert.equal(button.disabled, false);
  await chatgptButton(listeners)({ currentTarget: button });
  assert.equal(calls, 2);
  assert.equal(copied.length, 1);
  assert.equal(button.textContent, 'PROMPT COPIADO PARA CHATGPT');
});

test('mobile clipboard write starts in the click gesture before the fresh fetch resolves', async () => {
  let finishFetch;
  let writes = 0;
  const { listeners } = overviewScenario({
    fetchSalePulse: () => new Promise((resolve) => { finishFetch = resolve; }),
    writeClipboardItem: async ([item]) => {
      writes += 1;
      await item.data['text/plain'];
    },
  });
  const button = { disabled: false, textContent: '' };
  const copying = chatgptButton(listeners)({ currentTarget: button });
  assert.equal(writes, 1);
  assert.equal(button.disabled, true);
  finishFetch(pulse({ marketingPacket: handoffPacket }));
  await copying;
  assert.equal(button.textContent, 'PROMPT COPIADO PARA CHATGPT');
});

test('mobile clipboard failure permits a fresh retry', async () => {
  let fetches = 0;
  let writes = 0;
  const { listeners } = overviewScenario({
    fetchSalePulse: async () => { fetches += 1; return pulse({ marketingPacket: handoffPacket }); },
    writeClipboardItem: async ([item]) => {
      await item.data['text/plain'];
      writes += 1;
      if (writes === 1) throw new Error('Clipboard denied');
    },
  });
  const button = { disabled: false, textContent: '' };
  await chatgptButton(listeners)({ currentTarget: button });
  assert.equal(button.textContent, 'NO SE PUDO COPIAR · REINTENTAR');
  assert.equal(button.disabled, false);
  await chatgptButton(listeners)({ currentTarget: button });
  assert.equal(fetches, 2);
  assert.equal(writes, 2);
  assert.equal(button.textContent, 'PROMPT COPIADO PARA CHATGPT');
});

test('fresh response without a marketing packet never copies the cached packet', async () => {
  const copied = [];
  const { listeners } = overviewScenario({
    salePulse: pulse({ marketingPacket: handoffPacket }),
    fetchSalePulse: async () => pulse({ marketingPacket: null }),
    writeClipboardItem: async ([item]) => copied.push(await (await item.data['text/plain']).text()),
  });
  const button = { disabled: false, textContent: '' };
  await chatgptButton(listeners)({ currentTarget: button });
  assert.equal(copied.length, 0);
  assert.equal(button.textContent, 'NO SE PUDO ACTUALIZAR · REINTENTAR');
  assert.equal(button.disabled, false);
});

test('clipboard failure permits a fresh retry, including writeText fallback', async () => {
  let calls = 0;
  let writes = 0;
  const { listeners } = overviewScenario({
    fetchSalePulse: async () => { calls += 1; return pulse({ marketingPacket: handoffPacket }); },
    writeClipboard: async () => {
      writes += 1;
      if (writes === 1) throw new Error('Clipboard unavailable');
    },
  });
  const button = { disabled: false, textContent: '' };
  await chatgptButton(listeners)({ currentTarget: button });
  assert.equal(button.textContent, 'NO SE PUDO COPIAR · REINTENTAR');
  assert.equal(button.disabled, false);
  await chatgptButton(listeners)({ currentTarget: button });
  assert.equal(calls, 2);
  assert.equal(writes, 2);
  assert.equal(button.textContent, 'PROMPT COPIADO PARA CHATGPT');
});
