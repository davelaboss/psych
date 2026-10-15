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

function overviewScenario({ stats = {}, orders = [], salePulse = pulse() } = {}) {
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
    console,
    document: {
      getElementById(id) { return id === 'admin-tab-content' ? target : null; },
    },
    Intl,
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout,
    window: { addEventListener() {}, location: { pathname: '/admin' } },
  };
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
  });
  context.__adminOverview.renderOverviewTab();
  return { html: target.innerHTML, listeners };
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
