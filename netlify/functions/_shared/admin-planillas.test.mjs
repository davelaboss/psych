import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');
const batch = (id, status = 'OPEN', extra = {}) => ({
  fulfillmentBatchId: id, status, revision: 3, buyerGroupId: 'buyer-1',
  displayName: 'Comprador <de prueba>', displayPhone: '+595 000',
  timingKey: 'IMMEDIATE', timingLabel: 'Retiro inmediato', mergedIntoBatchId: null,
  items: [{ itemNumber: 999, productId: 'fixture', title: 'Mesa & sillas', quantity: 2, orderId: 'VM-TEST' }],
  ...extra,
});

function scenario(batches, { confirm = true, respond } = {}) {
  const calls = [], prints = [], alerts = [], confirmations = [], listeners = new Map();
  const controls = [{ disabled: false }, { disabled: false }];
  const target = {
    innerHTML: '',
    querySelector(selector) {
      return { addEventListener(type, listener) { listeners.set(`${selector}:${type}`, listener); } };
    },
    querySelectorAll(selector) { return selector === 'button, select' ? controls : []; },
  };
  const context = {
    Headers, console, Error,
    window: { addEventListener() {}, confirm(message) { confirmations.push(message); return confirm; } },
    alert(message) { alerts.push(message); },
    document: { getElementById() { return target; }, querySelector() { return null; } },
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      calls.push({ url, payload, token: options.headers.get('x-admin-token') });
      const result = respond ? await respond(payload, api) : { changedBatches: [{
        ...api.ADMIN_STATE.fulfillmentBatches.find(b => b.fulfillmentBatchId === payload.batchId),
        status: 'PREPARED', revision: payload.expectedRevision + 1,
      }] };
      return { ok: result.status ? false : true, status: result.status || 200,
        headers: new Headers({ 'content-type': 'application/json' }), json: async () => result };
    },
  };
  runInNewContext(`${source}\n;globalThis.api = {
    ADMIN_STATE, renderBuyerSheetsTab, renderFulfillmentBatchSheet, fulfillmentBatchesForFilter,
    prepareAndPrintAllFulfillmentBatches, prepareAndPrintFulfillmentBatch, printFulfillmentBatch,
  }; printFulfillmentBatches = globalThis.capturePrint;`, Object.assign(context, {
    capturePrint(batches) { prints.push(structuredClone(batches)); },
  }));
  const api = context.api;
  Object.assign(api.ADMIN_STATE, {
    token: 'synthetic-token', fulfillmentBatches: structuredClone(batches),
    orders: [{ id: 'VM-TEST', payments: [{ amount: 1 }], pickup: 'unchanged' }],
    inventory: [{ quantityRemaining: 2 }], buyerGroups: [{ id: 'buyer-1' }],
  });
  return { ...api, calls, prints, alerts, confirmations, target, controls, listeners };
}
const ids = batches => Array.from(batches, b => b.fulfillmentBatchId);

test('default/alternate filters exclude merged and empty batches without changing data', () => {
  const s = scenario([
    batch('open'), batch('prepared', 'PREPARED'), batch('legacy', 'LEGACY_FROZEN'),
    batch('delivered', 'DELIVERED'), batch('merged', 'OPEN', { mergedIntoBatchId: 'open' }),
    batch('empty', 'OPEN', { items: [] }),
  ]);
  const before = JSON.stringify(s.ADMIN_STATE);
  assert.equal(s.ADMIN_STATE.fulfillmentFilter, 'OPEN');
  for (const [filter, expected] of [
    [undefined, ['open']], ['UNDELIVERED', ['open', 'prepared', 'legacy']],
    ['PREPARED', ['prepared']], ['DELIVERED', ['delivered']],
    ['ALL', ['open', 'prepared', 'legacy', 'delivered']],
  ]) assert.deepEqual(ids(s.fulfillmentBatchesForFilter(filter)), expected);
  assert.equal(JSON.stringify(s.ADMIN_STATE), before);
  assert.equal(s.calls.length, 0);
});

test('filter changes, selected option and accurate counts persist after rerender', () => {
  const s = scenario([batch('a'), batch('b', 'PREPARED'), batch('c', 'DELIVERED')]);
  s.renderBuyerSheetsTab();
  assert.match(s.target.innerHTML, /aria-live="polite">1 planilla</);
  assert.match(s.target.innerHTML, /data-print-all-batches/);
  assert.doesNotMatch(s.target.innerHTML, /data-fulfillment-batch="c"/);
  s.listeners.get('[data-fulfillment-filter]:change')({ target: { value: 'UNDELIVERED' } });
  s.renderBuyerSheetsTab();
  assert.equal(s.ADMIN_STATE.fulfillmentFilter, 'UNDELIVERED');
  assert.match(s.target.innerHTML, /value="UNDELIVERED" selected/);
  assert.match(s.target.innerHTML, /aria-live="polite">2 planillas</);
  assert.doesNotMatch(s.target.innerHTML, /data-print-all-batches/);
  assert.equal(s.calls.length, 0);
});

test('combine candidates remain available across filters and sheet data is escaped', () => {
  const s = scenario([batch('a'), batch('b', 'PREPARED')]);
  s.renderBuyerSheetsTab();
  assert.match(s.target.innerHTML, /<option value="b">/);
  assert.doesNotMatch(s.target.innerHTML, /data-fulfillment-batch="b"/);
  assert.match(s.target.innerHTML, /Comprador &lt;de prueba&gt;/);
  assert.match(s.target.innerHTML, /Mesa &amp; sillas/);
  for (const text of ['+595 000', 'VM-TEST', '☐ Preparado', '☐ Entregado', '>2</td>']) {
    assert.ok(s.target.innerHTML.includes(text), text);
  }
});

test('bulk prepares eligible OPEN revisions once, preserves unrelated data, prints persisted snapshots once', async () => {
  const s = scenario([batch('a'), batch('b'), batch('prepared', 'PREPARED'),
    batch('merged', 'OPEN', { mergedIntoBatchId: 'a' }), batch('empty', 'OPEN', { items: [] })], {
    respond: async (payload, api) => ({ changedBatches: [{
      ...api.ADMIN_STATE.fulfillmentBatches.find(b => b.fulfillmentBatchId === payload.batchId),
      status: 'PREPARED', revision: 4, items: [{ ...batch('').items[0], title: `Persisted ${payload.batchId}` }],
    }] }),
  });
  const unrelated = () => JSON.stringify([s.ADMIN_STATE.orders, s.ADMIN_STATE.inventory, s.ADMIN_STATE.buyerGroups]);
  const before = unrelated();
  await s.prepareAndPrintAllFulfillmentBatches();
  assert.deepEqual(s.calls.map(c => c.payload), [
    { action: 'PREPARE', batchId: 'a', expectedRevision: 3 },
    { action: 'PREPARE', batchId: 'b', expectedRevision: 3 },
  ]);
  assert.ok(s.calls.every(c => c.url === '/api/admin/fulfillment-batches' && c.token === 'synthetic-token'));
  assert.equal(s.confirmations.length, 1);
  assert.equal(s.prints.length, 1);
  assert.deepEqual(ids(s.prints[0]), ['a', 'b']);
  assert.deepEqual(Array.from(s.prints[0], b => b.items[0].title), ['Persisted a', 'Persisted b']);
  assert.equal(s.fulfillmentBatchesForFilter().length, 0);
  assert.match(s.target.innerHTML, /0 planillas/);
  assert.equal(s.ADMIN_STATE.fulfillmentFilter, 'OPEN');
  assert.equal(unrelated(), before);
});

for (const failureStatus of [409, 500]) {
  for (const failAt of [0, 1, 2]) {
    test(`bulk stops at ${failureStatus} on batch ${failAt + 1}, reports every outcome and keeps successes`, async () => {
      const s = scenario(['a', 'b', 'c'].map(id => batch(id)), {
        respond: async (payload, api) => payload.batchId === ['a', 'b', 'c'][failAt]
          ? { status: failureStatus, error: failureStatus === 409 ? 'El lote cambió en otra pestaña.' : 'Sin conexión.' }
          : { changedBatches: [{ ...api.ADMIN_STATE.fulfillmentBatches.find(b => b.fulfillmentBatchId === payload.batchId), status: 'PREPARED' }] },
      });
      await s.prepareAndPrintAllFulfillmentBatches();
      assert.equal(s.calls.length, failAt + 1);
      assert.ok(s.calls.every(c => c.payload.action === 'PREPARE'));
      assert.equal(s.prints.length, failAt ? 1 : 0);
      if (failAt) assert.deepEqual(ids(s.prints[0]), ['a', 'b', 'c'].slice(0, failAt));
      assert.equal(s.alerts.length, 1);
      assert.ok(s.alerts[0].includes(`Preparados (${failAt}):`));
      assert.ok(s.alerts[0].includes(`Sin preparación confirmada: ${['a', 'b', 'c'][failAt]}`));
      assert.ok(s.alerts[0].includes(`No intentados: ${['a', 'b', 'c'].slice(failAt + 1).join(', ') || 'ninguno'}`));
      assert.equal(s.ADMIN_STATE.fulfillmentPreparing, false);
    });
  }
}

test('cancel, empty selection and a different filter make no requests or print jobs', async () => {
  const cancelled = scenario([batch('a')], { confirm: false });
  const empty = scenario([]);
  const filtered = scenario([batch('a')]);
  filtered.ADMIN_STATE.fulfillmentFilter = 'ALL';
  for (const s of [cancelled, empty, filtered]) {
    await s.prepareAndPrintAllFulfillmentBatches();
    assert.equal(s.calls.length, 0);
    assert.equal(s.prints.length, 0);
  }
});

test('in-flight guard prevents duplicate bulk/individual preparation and disables controls across rerenders', async () => {
  let finish;
  const s = scenario([batch('a')], { respond: () => new Promise(resolve => { finish = resolve; }) });
  const pending = s.prepareAndPrintAllFulfillmentBatches();
  await s.prepareAndPrintAllFulfillmentBatches();
  await s.prepareAndPrintFulfillmentBatch('a');
  s.renderBuyerSheetsTab();
  assert.equal(s.calls.length, 1);
  assert.equal(s.confirmations.length, 1);
  assert.ok(s.controls.every(c => c.disabled));
  finish({ changedBatches: [batch('a', 'PREPARED')] });
  await pending;
  assert.equal(s.prints.length, 1);
});

test('selection revisions stay fixed when an earlier response updates another selected batch', async () => {
  const s = scenario([batch('a'), batch('b')], {
    respond: async payload => ({ changedBatches: [batch(payload.batchId, 'PREPARED'),
      ...(payload.batchId === 'a' ? [batch('b', 'OPEN', { revision: 7 })] : [])] }),
  });
  await s.prepareAndPrintAllFulfillmentBatches();
  assert.equal(s.calls[1].payload.expectedRevision, 3);
});

test('unconfirmed response stops safely and never prints a local OPEN snapshot', async () => {
  const s = scenario([batch('a'), batch('b')], { respond: async () => ({ changedBatches: [] }) });
  await s.prepareAndPrintAllFulfillmentBatches();
  assert.equal(s.calls.length, 1);
  assert.equal(s.prints.length, 0);
  assert.match(s.alerts[0], /no confirmó la preparación/);
});

test('individual prepare still prints after OPEN disappears, and frozen/delivered reprints make no writes', async () => {
  const s = scenario([batch('a')]);
  await s.prepareAndPrintFulfillmentBatch('a');
  assert.equal(s.fulfillmentBatchesForFilter().length, 0);
  assert.equal(s.prints[0][0].status, 'PREPARED');
  assert.equal(s.calls.length, 1);
  for (const status of ['PREPARED', 'LEGACY_FROZEN', 'DELIVERED']) {
    s.ADMIN_STATE.fulfillmentBatches = [batch('a', status)];
    s.printFulfillmentBatch('a');
    assert.equal(s.prints.at(-1)[0].status, status);
  }
  assert.equal(s.calls.length, 1);
});
