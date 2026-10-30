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
        json: async () => options.method === 'POST' && JSON.parse(options.body).action === 'confirm'
          ? { campaign: value.regularCampaign } : { salePulse: value },
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
  runInNewContext(`${adminSource}\n;globalThis.__adminOverview = { ADMIN_STATE, renderOverviewTab, confirmRegularCampaign };`, context);
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
  return { html: target.innerHTML, listeners, state: context.__adminOverview.ADMIN_STATE,
    confirmRegularCampaign: context.__adminOverview.confirmRegularCampaign };
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
    category: 'Muebles', saleMode: 'IMMEDIATE', views: 12, cartAdds: 2,
    signals: { hotUnsold: true },
  }],
  signalLists: { hotUnsold: ['product-34'] },
};

function trustedSelection(products, overrides = {}) {
  const ids = products.slice(0, 10).map(p => p.productId);
  return { status: 'READY', campaignId: 'regular-chatgpt-daily-v1', cycleId: 'synthetic-cycle',
    passId: 'priority-over-50000-v1', passStartedAt: '2026-10-30T12:00:00Z',
    batchId: 'synthetic-batch', startedAt: '2026-10-20T15:00:00Z', revision: 1,
    historicalCompleteness: 'UNRECONCILED', phase: 'FIRST_PASS',
    selectedProductIds: ids, assignments: { David: ids.slice(0, 5), Maria: ids.slice(5) }, ...overrides };
}
handoffPacket.regularCampaign = trustedSelection(handoffPacket.marketableProducts);

function chatgptButton(listeners) {
  return listeners.find(({ selector }) => selector === '[data-copy-sale-pulse-chatgpt]').listener;
}

function handoffData(text) {
  assert.ok(text.endsWith('FIN DEL PAQUETE MOVIL'));
  const match = text.match(/\nCANDIDATOS_JSON\n([^\n]+)\nFIN_CANDIDATOS_JSON\n/);
  assert.ok(match);
  return JSON.parse(match[1]);
}

function largePacket() {
  const categories = ['Muebles', 'Oficina', 'Decoración', 'Hogar', 'Jardín', 'Electrónica', 'Cocina', 'Herramientas'];
  const marketableProducts = Array.from({ length: 310 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      productId: `product-${itemNumber}`, itemNumber,
      title: `Artículo de mudanza ${String(itemNumber).padStart(3, '0')} en buen estado para el hogar`,
      askingPricePYG: 75000 + itemNumber * 1000,
      category: categories[index % categories.length], saleMode: index % 4 ? 'IMMEDIATE' : 'DELAYED',
      purchasableQuantity: index % 5 ? 1 : 2, marketabilityStatus: 'MARKETABLE',
      productUrl: `/producto/articulo-de-mudanza-${itemNumber}?ref=catalogo`,
      mainImage: `/assets/media/articulo-de-mudanza-${itemNumber}-principal.webp`,
      views: index % 6 === 0 ? 0 : index % 19, cartAdds: index % 11 === 0 ? 3 : 0,
      signals: { hotUnsold: index % 11 === 0, attention: index % 7 === 0 },
      adminToken: 'secret-admin-token', buyerEmail: 'private@example.com',
    };
  });
  const unavailable = Array.from({ length: 110 }, (_, index) => ({
    productId: `unavailable-${index}`, itemNumber: 311 + index, title: `Unavailable ${index}`,
    marketabilityStatus: ['SOLD', 'TEMPORARILY_RESERVED', 'PENDING_PAYMENT_OR_CONFIRMATION', 'NOT_MARKETABLE'][index % 4],
  }));
  return {
    schemaVersion: 1, generatedAt: '2026-10-20T15:00:00Z',
    marketabilitySummary: { marketable: 310, sold: 28 },
    products: [...marketableProducts, ...unavailable], marketableProducts,
    regularCampaign: trustedSelection([...marketableProducts.slice(0, 6), ...marketableProducts.slice(-4)]),
  };
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
  assert.deepEqual(JSON.parse(requests[0].options.body), { action: 'prepare', campaignId: 'regular-chatgpt-daily-v1' });
  assert.equal(state.salePulse, fresh);
  assert.equal(copied.length, 1);
  assert.doesNotMatch(copied[0], /STALE PRODUCT|secret-admin-token|x-admin-token|cookie|session ID|receipt|bank/i);
  assert.match(copied[0], /drive\.google\.com\/drive\/folders\/13qE2dHUjJBr1TOBUX7omaWr7r1k2nfct/);
  assert.match(copied[0], /autoridad FINAL/);
  assert.match(copied[0], /SUBCONJUNTO DE CANDIDATOS COMERCIALIZABLES ACTUALES/);
  assert.match(copied[0], /hasta 10 Items únicos, 5 para David y 5 para María/);
  assert.match(copied[0], /cinco Stories individuales por persona: un producto y una foto auténtica por Story/);
  assert.match(copied[0], /un solo Link sticker al detalle de ese producto, src=story y texto VER ARTÍCULO/);
  assert.doesNotMatch(copied[0], /propone un collage de 3 productos|crear collages/);
  assert.match(copied[0], /Instagram Stories: cada foto lleva su propio Link sticker directo con src=story/);
  assert.match(copied[0], /WhatsApp Status\/Updates: prepara entradas nativas individuales con URL directa clicable con src=story/);
  assert.match(copied[0], /ni supongas que el Link sticker de Instagram sigue siendo clicable/);
  assert.match(copied[0], /Grupo de WhatsApp Compras\/Ventas\/Servicios: añade o actualiza src=jw-group/);
  assert.match(copied[0], /Select Multiple > fotos numeradas > Next > Separate/);
  assert.match(copied[0], /Marketplace > Sell > Create listing > One item > Add photos/);
  assert.match(copied[0], /More > Send a copy > Save image/);
  assert.match(copied[0], /No publiques automáticamente/);
  const data = handoffData(copied[0]);
  assert.equal(data.generatedAt, handoffPacket.generatedAt);
  assert.equal(data.snapshotTotalMarketable, 1);
  assert.equal(data.includedCandidates, 1);
  assert.equal(data.candidates[0].productUrl, 'https://thelabossieres.com/producto/mesa-actual?ref=catalogo');
  assert.equal(data.candidates[0].mainImageUrl, 'https://thelabossieres.com/assets/media/mesa-actual.jpg');
  assert.equal(data.candidates[0].views7d, 12);
  assert.deepEqual(Array.from(data.candidates[0].signals), ['hotUnsold']);
  assert.doesNotMatch(copied[0], /REFERENCIAS DE ENLACES|PAQUETE SALE PULSE ACTUAL COMPLETO|storyUrl|whatsappGroupUrl/);
  assert.equal(button.textContent, 'PROMPT COPIADO PARA CHATGPT');
  assert.equal(button.disabled, false);
});

test('420-product snapshot copies exactly the authoritative ten including Items beyond the former shortlist', async () => {
  const packet = largePacket();
  const copied = [];
  const { listeners } = overviewScenario({
    fetchSalePulse: async () => pulse({ marketingPacket: packet }),
    writeClipboardItem: async ([item]) => copied.push(await (await item.data['text/plain']).text()),
  });
  await chatgptButton(listeners)({ currentTarget: { disabled: false, textContent: '' } });
  assert.equal(copied.length, 1);
  assert.ok(copied[0].length <= 18000, `Copied ${copied[0].length} characters`);
  const data = handoffData(copied[0]);
  assert.equal(data.snapshotTotalMarketable, 310);
  assert.equal(data.includedCandidates, data.candidates.length);
  assert.equal(data.candidates.length, 10);
  assert.deepEqual(data.candidates.map(p => p.productId), packet.regularCampaign.selectedProductIds);
  assert.equal(new Set(data.candidates.map((product) => product.productId)).size, data.candidates.length);
  assert.ok(new Set(data.candidates.map((product) => product.category)).size >= 6);
  assert.ok(data.candidates.some((product) => product.views7d === 0));
  assert.ok(data.candidates.some((product) => product.cartAdds7d > 0));
  assert.ok(data.candidates.some((product) => product.itemNumber <= 30));
  assert.ok(data.candidates.some((product) => product.itemNumber >= 280));
  for (const candidate of data.candidates) {
    const source = packet.marketableProducts.find((product) => product.productId === candidate.productId);
    assert.ok(source);
    assert.equal(candidate.title, source.title);
    assert.equal(candidate.askingPricePYG, source.askingPricePYG);
    assert.equal(candidate.saleMode, source.saleMode);
    assert.equal(candidate.purchasableQuantity, source.purchasableQuantity);
    assert.equal(candidate.productUrl, new URL(source.productUrl, 'https://thelabossieres.com').href);
    assert.equal(candidate.mainImageUrl, new URL(source.mainImage, 'https://thelabossieres.com').href);
    assert.equal(candidate.views7d, source.views);
    assert.equal(candidate.cartAdds7d, source.cartAdds);
  }
  assert.doesNotMatch(copied[0], /Unavailable|secret-admin-token|private@example.com|"products"|storyUrl|whatsappGroupUrl/);
  assert.match(copied[0], /productos omitidos no se consideran vendidos ni no disponibles/);
  assert.match(copied[0], /Si falta, no hagas recomendaciones de productos/);
});

test('handoff caps each person at four JW entries from their own five products', async () => {
  const copied = [];
  const { listeners } = overviewScenario({
    fetchSalePulse: async () => pulse({ marketingPacket: largePacket() }),
    writeClipboard: async (text) => copied.push(text),
  });
  await chatgptButton(listeners)({ currentTarget: { disabled: false, textContent: '' } });
  const text = copied[0];
  assert.match(text, /hasta 10 Items únicos, 5 para David y 5 para María, sin repetir entre ambos/);
  assert.match(text, /documento de texto de marketing por persona: sus cinco Stories, cinco WhatsApp Status de los mismos cinco productos/);
  assert.match(text, /solo cuatro entradas de productos por persona, elegidas entre sus cinco por probable potencial de venta/);
  assert.match(text, /si hay menos de cuatro válidos, usa solo esos/);
  assert.match(text, /No agregues productos ni una quinta entrada o foto de JW Group/);
  assert.match(text, /Grupo de WhatsApp[\s\S]*?src=jw-group[\s\S]*?No agregues productos ni una quinta entrada o foto de JW Group/);
  assert.doesNotMatch(text, /envíos de cuatro y una|la quinta por separado|luego la quinta/);
});

test('promotional copy excludes routine logistics while preserving material disclosures and preview safeguards', async () => {
  const copied = [];
  const { listeners } = overviewScenario({
    fetchSalePulse: async () => pulse({ marketingPacket: handoffPacket }),
    writeClipboard: async (text) => copied.push(text),
  });
  await chatgptButton(listeners)({ currentTarget: { disabled: false, textContent: '' } });
  const text = copied[0];
  assert.match(text, /Stories, Status y JW Group, usa nombre, precio, descripción breve y veraz, foto auténtica y enlace directo/);
  assert.match(text, /Omite texto rutinario sobre plazos de pago, fechas o arreglos de retiro, ubicación, entrega, transporte, objetos ajenos visibles y otros avisos administrativos/);
  assert.match(text, /Señala una limitación material inusual si omitirla puede engañar al comprador/);
  assert.match(text, /Conserva sin cambios las condiciones, inclusiones, exclusiones y advertencias reales en el sitio y checkout/);
  assert.doesNotMatch(text, /precio, retiro y URL|Ubicación: San Lorenzo|Sin entrega|1 al 8 de diciembre|9 al 12 de diciembre|Menciona estos plazos/);
  assert.match(text, /parámetro nuevo de caché[\s\S]*?conservando src y los demás parámetros[\s\S]*?No añadas src a mainImageUrl/);
  assert.match(text, /Prepara borradores para aprobación de David/);
  assert.ok(text.length <= 18000);
  handoffData(text);
});

test('unreconciled older history allows an active-cycle handoff and independent data is not exported', async () => {
  const copied = [];
  const packet = { ...handoffPacket, history: [
    { productId: 'product-34', status: 'PREPARED', campaign: 'regular' },
    { productId: 'product-34', status: 'POSTED', campaign: 'independent' },
  ] };
  const { listeners } = overviewScenario({
    fetchSalePulse: async () => pulse({ marketingPacket: packet }),
    writeClipboard: async (text) => copied.push(text),
  });
  await chatgptButton(listeners)({ currentTarget: { disabled: false, textContent: '' } });
  const text = copied[0];
  assert.match(text, /PREPARED no es POSTED/);
  assert.match(text, /No detengas por incertidumbre anterior/);
  assert.match(text, /UNCONFIRMED en esta pasada no significa históricamente NEVER POSTED/);
  assert.match(text, /passId[\s\S]*?passStartedAt/);
  assert.match(text, /estrictamente mayor a ₲50.000/);
  assert.match(text, /no regeneres materiales ni inicies una repetición automática/);
  assert.match(text, /anuncios independientes de David o María no cuentan; no los registres ni pidas reportarlos/);
  assert.equal(handoffData(text).regularCampaign.historicalCompleteness, 'UNRECONCILED');
  assert.doesNotMatch(JSON.stringify(handoffData(text)), /"history"|"POSTED"|"PREPARED"/);
  assert.doesNotMatch(text, /Evita repeticiones sin ángulo nuevo/);
});

test('under ten marketable Items includes every eligible candidate and states the limit', async () => {
  const packet = largePacket();
  packet.marketableProducts = packet.marketableProducts.slice(0, 7);
  packet.regularCampaign = trustedSelection(packet.marketableProducts);
  const copied = [];
  const { listeners } = overviewScenario({
    fetchSalePulse: async () => pulse({ marketingPacket: packet }),
    writeClipboardItem: async ([item]) => copied.push(await (await item.data['text/plain']).text()),
  });
  await chatgptButton(listeners)({ currentTarget: { disabled: false, textContent: '' } });
  assert.equal(handoffData(copied[0]).includedCandidates, 7);
  assert.match(copied[0], /LIMITACIÓN ACTUAL: solo hay 7 Items en esta selección del ciclo/);
  assert.match(copied[0], /sin rellenar con repetidos para llegar a 5\+5/);
});

test('inconsistent marketable input cannot select sold, held, unlisted, or duplicate Items', async () => {
  const packet = largePacket();
  const valid = packet.marketableProducts.slice(0, 16);
  packet.marketableProducts = [
    ...valid,
    ...['SOLD', 'TEMPORARILY_RESERVED', 'PENDING_PAYMENT_OR_CONFIRMATION', 'NOT_MARKETABLE']
      .map((marketabilityStatus, index) => ({ ...valid[index], productId: `unsafe-${index}`, marketabilityStatus })),
    { ...valid[0], productId: 'zero-stock', purchasableQuantity: 0 },
    { ...valid[0], productId: 'no-photo', mainImage: null },
    { ...valid[0], itemNumber: 999 },
  ];
  packet.regularCampaign = trustedSelection(valid);
  const copied = [];
  const { listeners } = overviewScenario({
    fetchSalePulse: async () => pulse({ marketingPacket: packet }),
    writeClipboardItem: async ([item]) => copied.push(await (await item.data['text/plain']).text()),
  });
  await chatgptButton(listeners)({ currentTarget: { disabled: false, textContent: '' } });
  const candidates = handoffData(copied[0]).candidates;
  assert.equal(candidates.length, 10);
  assert.ok(candidates.every((candidate) => valid.some((product) => product.productId === candidate.productId)));
});

test('oversized mandatory candidate data never writes a partial clipboard result', async () => {
  const packet = largePacket();
  packet.marketableProducts = packet.marketableProducts.slice(0, 10).map((product) => ({
    ...product, title: `Item ${product.itemNumber} ${'L'.repeat(1900)}`,
  }));
  packet.regularCampaign = trustedSelection(packet.marketableProducts);
  let copies = 0;
  const { listeners } = overviewScenario({
    fetchSalePulse: async () => pulse({ marketingPacket: packet }),
    writeClipboardItem: async ([item]) => { await item.data['text/plain']; copies += 1; },
  });
  const button = { disabled: false, textContent: '' };
  await chatgptButton(listeners)({ currentTarget: button });
  assert.equal(copies, 0);
  assert.match(button.textContent, /PAQUETE MÓVIL MUY GRANDE · NO COPIADO/);
  assert.equal(button.disabled, false);
});

test('the separate report and raw packet buttons still copy their original content', async () => {
  const copied = [];
  const { listeners } = overviewScenario({
    salePulse: pulse({ marketingPacket: handoffPacket }),
    writeClipboard: async (text) => copied.push(text),
  });
  const report = listeners.find(({ selector }) => selector === '[data-copy-sale-pulse]').listener;
  const raw = listeners.find(({ selector }) => selector === '[data-copy-sale-pulse-packet]').listener;
  await report({ currentTarget: { disabled: false, textContent: '' } });
  await raw({ currentTarget: { disabled: false, textContent: '' } });
  assert.equal(copied[0], 'Informe diario');
  assert.deepEqual(JSON.parse(copied[1]), handoffPacket);
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

test('clipboard fails closed on missing active history or an unavailable authoritative selection', async () => {
  for (const regularCampaign of [undefined,
    {...handoffPacket.regularCampaign, status:'UNAVAILABLE'},
    {...handoffPacket.regularCampaign, selectedProductIds:['sold-product'], assignments:{David:['sold-product'],Maria:[]}},
    {...handoffPacket.regularCampaign, assignments:{David:['product-34'],Maria:['product-34']}},
  ]) {
    const copied=[];
    const {listeners}=overviewScenario({fetchSalePulse:async()=>pulse({marketingPacket:{...handoffPacket,regularCampaign}}),
      writeClipboard:async text=>copied.push(text)});
    const button={disabled:false,textContent:''};
    await chatgptButton(listeners)({currentTarget:button});
    assert.equal(copied.length,0);
    assert.match(button.textContent,/HISTORIAL NO FIABLE|DATOS INCOMPLETOS/);
  }
});

test('clipboard refuses selected products at or below the priority price floor', async () => {
  for (const askingPricePYG of [50000, 49999]) {
    const packet = structuredClone(handoffPacket), copied = [];
    packet.marketableProducts[0].askingPricePYG = askingPricePYG;
    const {listeners} = overviewScenario({fetchSalePulse:async()=>pulse({marketingPacket:packet}),
      writeClipboard:async text=>copied.push(text)});
    const button = {disabled:false,textContent:''};
    await chatgptButton(listeners)({currentTarget:button});
    assert.equal(copied.length, 0);
    assert.match(button.textContent, /DATOS INCOMPLETOS/);
  }
});

test('short first pass remains short even when the full marketable catalog contains hundreds of repeats', async () => {
  const packet=largePacket();
  packet.regularCampaign=trustedSelection(packet.marketableProducts.slice(-2));
  const copied=[];
  const {listeners}=overviewScenario({fetchSalePulse:async()=>pulse({marketingPacket:packet}),writeClipboard:async text=>copied.push(text)});
  await chatgptButton(listeners)({currentTarget:{disabled:false,textContent:''}});
  const data=handoffData(copied[0]);
  assert.equal(data.snapshotTotalMarketable,310);
  assert.equal(data.includedCandidates,2);
  assert.deepEqual(data.candidates.map(p=>p.productId),['product-309','product-310']);
  assert.match(copied[0],/solo hay 2 Items en esta selección del ciclo/);
});

test('one person-batch confirmation submits only checked published Items and preserves the regular campaign identity', async () => {
  const requests=[];
  const current={status:'READY',campaignId:'regular-chatgpt-daily-v1',cycleId:'cycle-1',startedAt:'2026-10-28T15:00:00Z',pendingBatches:[
    {id:'batch-1',date:'2026-10-28',phase:'FIRST_PASS',assignments:{David:[{productId:'product-1',itemNumber:1},{productId:'product-2',itemNumber:2}],Maria:[]}},
  ]};
  const updated={...current,pendingBatches:[]};
  const {html,state,confirmRegularCampaign}=overviewScenario({salePulse:pulse({regularCampaign:current}),
    fetchSalePulse:async(url,options)=>{requests.push({url,options});return pulse({regularCampaign:updated});}});
  assert.match(html,/CONFIRMO PUBLICADOS — David/);
  assert.match(html,/dejá marcados únicamente los Items realmente publicados/);
  assert.doesNotMatch(html,/CONFIRMO PUBLICADOS — Maria/);
  const attributes={'data-cycle':'cycle-1','data-batch':'batch-1','data-person':'David'};
  const button={disabled:false,textContent:'',getAttribute:name=>attributes[name],
    closest:()=>({querySelectorAll:()=>[{value:'product-2'}]})};
  await confirmRegularCampaign(button);
  assert.equal(requests.length,1);
  assert.deepEqual(JSON.parse(requests[0].options.body),{action:'confirm',campaignId:'regular-chatgpt-daily-v1',
    cycleId:'cycle-1',batchId:'batch-1',person:'David',productIds:['product-2'],confirmation:'PUBLISHED_REGULAR_CAMPAIGN'});
  assert.equal(requests[0].options.headers.get('x-admin-token'),'secret-admin-token');
  assert.equal(state.salePulse.regularCampaign,updated);
});

test('failed publication confirmation is retryable and never updates the displayed history optimistically', async () => {
  const original={status:'READY',pendingBatches:[]};
  const {state,confirmRegularCampaign}=overviewScenario({salePulse:pulse({regularCampaign:original}),
    fetchSalePulse:async()=>{throw Error('offline');}});
  const button={disabled:false,textContent:'',getAttribute:()=> 'synthetic',closest:()=>({querySelectorAll:()=>[{value:'product-1'}]})};
  await confirmRegularCampaign(button);
  assert.equal(state.salePulse.regularCampaign,original);
  assert.equal(button.disabled,false);
  assert.match(button.textContent,/NO SE PUDO CONFIRMAR/);
});
