import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const oldEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { getStore } = await import('@netlify/blobs');
const { REGULAR_CAMPAIGN, PRIORITY_PASS, ASSIGNMENT_POLICY, LEDGER_KEY, BASELINE_KEY,
  campaignPanel, validateCampaignHistory, updateRegularCampaign, supersedeCampaignAssignments, deferCampaignAssignments } = await import('./regular-campaign.mjs');
if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
const clone = structuredClone;
const id = n => `item-${n}`;
const entry = (n, postedAt = null) => ({ productId: id(n), itemNumber: n, postedAt, ...(postedAt ? { confirmedBy: 'SELLER_ADMIN' } : {}) });

function fixture() {
  const history = { schemaVersion: 1, campaignId: REGULAR_CAMPAIGN, cycleId: 'cycle-test',
    startedAt: '2026-11-02T15:00:00Z', historicalCompleteness: 'UNRECONCILED', revision: 10,
    preparationEvidence: [], initialization: 'ESTABLISHED', batches: [
      { id: 'earlier', campaignId: REGULAR_CAMPAIGN, cycleId: 'cycle-test', date: '2026-11-02',
        preparedAt: '2026-11-02T15:00:00Z', phase: 'FIRST_PASS', passId: PRIORITY_PASS,
        assignmentPolicy: ASSIGNMENT_POLICY, assignments: { David: [entry(274, '2026-11-02T17:00:00Z')],
          Maria: [entry(19, '2026-11-02T19:02:02.589Z'), entry(39, '2026-11-02T19:02:02.589Z')] } },
      { id: 'target', campaignId: REGULAR_CAMPAIGN, cycleId: 'cycle-test', date: '2026-11-02',
        preparedAt: '2026-11-02T19:02:22.558Z', phase: 'FIRST_PASS', passId: PRIORITY_PASS,
        assignmentPolicy: ASSIGNMENT_POLICY, assignments: { David: [443,101,322,367,357].map(n => entry(n)),
          Maria: [486,95,113,394,425].map(n => entry(n)) } },
    ] };
  const baseline = { campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId, startedAt: history.startedAt,
    historicalCompleteness: history.historicalCompleteness };
  const files = new Map([[LEDGER_KEY, { data: clone(history), etag: 'version-10' }],
    [BASELINE_KEY, { data: baseline, etag: 'anchor' }]]);
  let serial = 10;
  const h = { files, requests: [], beforePut: null, afterPut: null, fault: null, readFault: null };
  h.store = getStore({ name: 'test-campaign', siteID: 'test-site', token: 'test-token', consistency: 'strong',
    edgeURL: 'https://reconciliation.test.invalid', uncachedEdgeURL: 'https://reconciliation.test.invalid',
    fetch: async (input, options) => {
      assert.equal(new URL(input).hostname, 'reconciliation.test.invalid');
      const key = decodeURIComponent(new URL(input).pathname.split('/').at(-1));
      const method = options.method.toUpperCase();
      h.requests.push({ key, method });
      if (method === 'GET') {
        if (h.readFault?.(key)) return new Response(null, { status: 503 });
        const row = files.get(key);
        return row ? new Response(JSON.stringify(row.data), { status: 200, headers: { etag: row.etag } }) : new Response(null, { status: 404 });
      }
      assert.equal(method, 'PUT'); assert.equal(key, LEDGER_KEY, 'Never writes baseline or other stores');
      const data = JSON.parse(options.body), match = new Headers(options.headers).get('if-match');
      assert.ok(match, 'Every reconciliation is conditional');
      if (h.beforePut) await h.beforePut(data);
      if (match !== files.get(key).etag) return new Response(null, { status: 412 });
      if (h.fault) return new Response(null, { status: h.fault.status, headers: h.fault.etag ? { etag: h.fault.etag } : {} });
      const etag = `version-${++serial}`;
      files.set(key, { data: clone(data), etag });
      if (h.afterPut) await h.afterPut(data);
      return new Response(null, { status: 200, headers: { etag } });
    } });
  h.initial = clone(history); h.anchor = clone(files.get(BASELINE_KEY));
  h.operation = { campaignId: REGULAR_CAMPAIGN, cycleId: history.cycleId, expectedRevision: 10, expectedEtag: 'version-10',
    id: 'correction', batchId: 'target', person: 'Maria', productIds: [id(113), id(425)],
    reason: 'Owner-approved November 2 dashboard correction; no new posting claims.', approvalReference: 'Governance owner decision 2026-11-03' };
  h.reconcile = (operation = h.operation) => supersedeCampaignAssignments({ operation, store: h.store, now: () => '2026-11-03T19:00:00Z' });
  h.history = () => clone(files.get(LEDGER_KEY).data);
  h.packet = () => ({ generatedAt: '2026-11-03T19:00:00Z', marketableProducts: [443,101,322,367,357,486,95,113,394,425,19,39,900].map(n => ({
    productId: id(n), itemNumber: n, title: `Item ${n}`, category: 'Hogar', saleMode: 'IMMEDIATE', askingPricePYG: 100000,
    purchasableQuantity: 1, marketabilityStatus: 'MARKETABLE', productUrl: `/producto/${n}`, mainImage: '/image.jpg',
  })) });
  h.run = body => updateRegularCampaign({ body: { campaignId: REGULAR_CAMPAIGN, ...body }, store: h.store,
    loadPacket: async () => h.packet(), now: () => '2026-11-03T20:00:00Z', idFactory: () => 'next-batch' });
  h.confirm = (person, numbers) => h.run({ action: 'confirm', cycleId: 'cycle-test', batchId: 'target', person,
    productIds: numbers.map(id), confirmation: 'PUBLISHED_REGULAR_CAMPAIGN' });
  return h;
}

test('supersession preserves every original record and baseline, adds no POSTED or replacement occurrence', async () => {
  const h = fixture(), result = await h.reconcile();
  assert.equal(result.changed, true); assert.equal(result.history.schemaVersion, 2); assert.equal(result.history.revision, 11);
  assert.deepEqual(result.history.batches, h.initial.batches); assert.deepEqual(h.files.get(BASELINE_KEY), h.anchor);
  assert.deepEqual(result.campaign.pendingBatches[0].assignments.Maria.map(p => p.itemNumber), [486,95,394]);
  assert.deepEqual(result.campaign.pendingBatches[0].assignments.David.map(p => p.itemNumber), [443,101,322,367,357]);
  assert.deepEqual(result.campaign.supersessions[0].itemNumbers, [113,425]);
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 1);
});

test('same operation is idempotent, retains audit timestamp, and conflicting reused ID fails', async () => {
  const h = fixture(); await h.reconcile(); const before = h.history();
  assert.equal((await h.reconcile()).changed, false); assert.deepEqual(h.history(), before);
  await assert.rejects(h.reconcile({ ...h.operation, reason: 'Different decision' }), /otra conciliación/);
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 1);
});

test('stale revision/ETag and newly posted affected assignments stop without writes', async () => {
  for (const mutate of [row => row.etag = 'new-version', row => row.data.revision++, row => row.data.batches[1].assignments.Maria[2] = entry(113, '2026-11-03T18:00:00Z')]) {
    const h = fixture(); mutate(h.files.get(LEDGER_KEY));
    await assert.rejects(h.reconcile()); assert.equal(h.requests.filter(r => r.method === 'PUT').length, 0);
  }
});

test('confirmation rejects superseded and mixed stale submissions atomically, while David is unchanged', async () => {
  const h = fixture(); await h.reconcile(); const before = h.history();
  for (const numbers of [[113], [425], [486,95,113,394,425]]) await assert.rejects(h.confirm('Maria', numbers), /no pertenecen/);
  assert.deepEqual(h.history(), before);
  await h.confirm('David', [443,101,322,367,357]); await h.confirm('Maria', [486]);
  const once = h.history(); await h.confirm('Maria', [486]); assert.deepEqual(h.history(), once);
  assert.deepEqual(h.history().batches[0], h.initial.batches[0]);
});

test('after remaining confirmations normal selection advances without 113/425 or duplicate 019/039', async () => {
  const h = fixture(); await h.reconcile();
  await h.confirm('David', [443,101,322,367,357]); await h.confirm('Maria', [486,95,394]);
  assert.equal(campaignPanel(h.history()).pendingBatches.length, 0);
  const next = await h.run({ action: 'prepare' });
  assert.equal(next.packet.regularCampaign.batchId, 'next-batch');
  assert.deepEqual(next.packet.regularCampaign.selectedProductIds, [id(900)]);
  assert.deepEqual(h.history().batches[0], h.initial.batches[0]);
  assert.ok(h.history().batches[1].assignments.Maria.filter(p => [113,425].includes(p.itemNumber)).every(p => p.postedAt === null));
});

test('ineligible retained assignments do not block progression; later eligibility cannot revive withdrawn products', async () => {
  const h = fixture(); await h.reconcile();
  const packet = h.packet(); packet.marketableProducts = packet.marketableProducts.filter(p => [113,425,19,39,900].includes(p.itemNumber));
  h.packet = () => packet;
  const next = await h.run({ action: 'prepare' }); assert.equal(next.packet.regularCampaign.batchId, 'next-batch');
  assert.deepEqual(next.packet.regularCampaign.selectedProductIds, [id(900)]);
});

test('withdrawn Maria pickup mode no longer invalidates reuse of still-valid assignments', async () => {
  const h = fixture(); await h.reconcile();
  const packet = h.packet(); packet.marketableProducts.find(p => p.itemNumber === 113).saleMode = 'DELAYED'; h.packet = () => packet;
  const reused = await h.run({ action: 'prepare' });
  assert.equal(reused.packet.regularCampaign.batchId, 'target');
  assert.deepEqual(reused.packet.regularCampaign.assignments.Maria, [486,95,394].map(id));
});

test('CAS conflict preserves concurrent confirmation and requires a refreshed reviewed operation', async () => {
  const h = fixture();
  h.beforePut = () => { h.beforePut = null; const row = h.files.get(LEDGER_KEY); row.etag = 'concurrent'; row.data.revision++;
    row.data.batches[1].assignments.David[0] = entry(443, '2026-11-03T18:00:00Z'); };
  await assert.rejects(h.reconcile(), /cambió/);
  assert.equal(h.history().schemaVersion, 1); assert.ok(h.history().batches[1].assignments.David[0].postedAt);
  await h.reconcile({ ...h.operation, expectedEtag: 'concurrent', expectedRevision: 11 });
  assert.ok(h.history().batches[1].assignments.David[0].postedAt);
});

for (const fault of [{ status: 503 }, { status: 403 }, { status: 200 }, { status: 200, etag: 'W/"weak"' }]) {
  test(`real locked SDK refuses unverifiable reconciliation success ${JSON.stringify(fault)}`, async () => {
    const h = fixture(); h.fault = fault;
    await assert.rejects(h.reconcile(), error => error.status === 503);
    assert.deepEqual(h.history(), h.initial);
  });
}

test('newer readback retaining correction and concurrent legitimate confirmation is accepted', async () => {
  const h = fixture(); h.afterPut = () => { const row = h.files.get(LEDGER_KEY); row.etag = 'newer'; row.data.revision++;
    row.data.batches[1].assignments.David[0] = entry(443, '2026-11-03T19:30:00Z'); };
  const result = await h.reconcile(); assert.equal(result.history.revision, 12);
  assert.ok(result.history.batches[1].assignments.David[0].postedAt); assert.equal(result.history.supersessions.length, 1);
});

test('newer revision missing intended supersession is never acknowledged', async () => {
  const h = fixture(); h.afterPut = () => { h.files.set(LEDGER_KEY, { data: { ...clone(h.initial), revision: 12 }, etag: 'newer-without-correction' }); };
  await assert.rejects(h.reconcile(), error => error.status === 503);
});

test('readback failure after committed correction is safely recovered by idempotent retry', async () => {
  const h = fixture(); h.afterPut = () => { h.readFault = () => true; };
  await assert.rejects(h.reconcile()); assert.equal(h.history().supersessions.length, 1);
  h.readFault = null; h.afterPut = null;
  assert.equal((await h.reconcile()).changed, false);
});

test('validation rejects corrupt references, duplicate targets, schema downgrade and fabricated POSTED', async () => {
  const h = fixture(); await h.reconcile();
  for (const mutate of [
    history => history.schemaVersion = 1,
    history => history.supersessions[0].person = 'David',
    history => history.supersessions[0].productIds = [id(19)],
    history => history.supersessions.push({ ...history.supersessions[0], id: 'second' }),
    history => history.batches[1].assignments.Maria[2] = entry(113, '2026-11-03T20:00:00Z'),
    history => history.supersessions[0].recordedAt = '2026-10-01T00:00:00Z',
    history => history.supersessions[0].unexpected = true,
  ]) { const history = h.history(); mutate(history); assert.throws(() => validateCampaignHistory(history)); }
});

test('v1 remains readable; original v1 code fails closed on reconciled v2 history', async () => {
  const h = fixture(); assert.equal(campaignPanel(h.initial).pendingBatches[0].assignments.Maria.length, 5);
  await h.reconcile();
  // This is the old reader's explicit schema gate, preserving rollback safety.
  assert.notEqual(h.history().schemaVersion, 1);
});

test('actual Admin renderer has only three Maria checkboxes, unchanged David controls and audit-only 113/425', async () => {
  const h = fixture(), { campaign } = await h.reconcile();
  const source = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');
  const start = source.indexOf('function regularCampaignControls()'), end = source.indexOf('\nfunction renderRegularCampaignStatus()', start);
  const html = runInNewContext(source.slice(start, end) + '\nregularCampaignControls()', {
    ADMIN_STATE: { salePulse: { regularCampaign: campaign } }, adminEscape: text => String(text).replaceAll('<','&lt;'), salePulseDate: value => value,
  });
  assert.deepEqual([...html.matchAll(/data-regular-product value="([^"]+)"/g)].map(match => match[1]), [443,101,322,367,357,486,95,394].map(id));
  assert.match(html, /Items 113, 425/); assert.match(html, /Sustituidas, sin confirmar/);
  assert.doesNotMatch(html, /data-regular-product value="item-(19|39|113|425)"/);
});

test('operator command defaults to an offline exact-target plan and leaves input files unchanged', async () => {
  const h = fixture(), cycle = 'c92e1d2b-5284-4350-a9e2-f886b897cfaa', batchId = 'be882a9c-0b87-4270-b23a-5eaf77a9b56b';
  const history = h.history(); history.cycleId = cycle;
  history.batches.forEach(batch => { batch.cycleId = cycle; }); history.batches[1].id = batchId;
  const ids = { 113: 'real-202609-volume2-113', 425: 'real-202610-volume4-425' };
  history.batches[1].assignments.Maria.forEach(item => { if (ids[item.itemNumber]) item.productId = ids[item.itemNumber]; });
  const snapshot = { ledger: { data: history, etag: 'version-10' }, baseline: { data: { ...h.anchor.data, cycleId: cycle }, etag: 'anchor' } };
  const operation = { ...h.operation, id: 'governance-20261103-nov2-maria-113-425', cycleId: cycle, batchId, productIds: Object.values(ids) };
  const dir = await mkdtemp(join(tmpdir(), 'campaign-offline-'));
  const snapshotPath = join(dir, 'snapshot.json'), operationPath = join(dir, 'operation.json');
  const source = JSON.stringify(snapshot); await writeFile(snapshotPath, source); await writeFile(operationPath, JSON.stringify(operation));
  const command = new URL('../../../tools/campaign-reconciliation/reconcile.mjs', import.meta.url);
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(command), '--operation', operationPath, '--snapshot', snapshotPath]);
  const planned = JSON.parse(stdout);
  assert.equal(planned.mode, 'OFFLINE_PLAN_ONLY'); assert.equal(planned.revision, 11);
  assert.deepEqual(planned.campaign.pendingBatches[0].assignments.Maria.map(item => item.itemNumber), [486,95,394]);
  assert.equal(await readFile(snapshotPath, 'utf8'), source);
  await writeFile(operationPath, JSON.stringify({ ...operation, person: 'David' }));
  await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(command), '--operation', operationPath, '--snapshot', snapshotPath]), /only the reviewed/);
});

test('confirmation readback accepts concurrent append-only supersession without losing its own POSTED', async () => {
  const h = fixture();
  h.afterPut = () => { h.afterPut = null; const row = h.files.get(LEDGER_KEY); row.data.schemaVersion = 2;
    row.data.supersessions = [{ id: 'concurrent-correction', batchId: 'target', person: 'Maria', productIds: [id(113),id(425)],
      sourceRevision: row.data.revision, reason: 'Reviewed correction', approvalReference: 'Owner decision',
      recordedAt: '2026-11-03T20:01:00Z', recordedBy: 'GOVERNANCE_OPERATOR' }]; row.data.revision++; row.etag = 'concurrent-supersession'; };
  const result = await h.confirm('David', [443]);
  assert.equal(result.campaign.supersessions.length, 1);
  assert.ok(h.history().batches[1].assignments.David[0].postedAt);
  assert.deepEqual(result.campaign.pendingBatches[0].assignments.Maria.map(item => item.itemNumber), [486,95,394]);
});

test('real SDK deferral verifies append-only readback alongside a concurrent earlier publication', async () => {
  const h = fixture();
  h.afterPut = () => { h.afterPut = null; const row = h.files.get(LEDGER_KEY);
    row.data.batches[1].assignments.David[0] = entry(443, '2026-11-03T18:00:00Z');
    row.data.revision++; row.etag = 'concurrent-publication'; };
  const result = await deferCampaignAssignments({ operation: h.operation, store: h.store, now: () => '2026-11-03T19:00:00Z' });
  assert.equal(result.history.schemaVersion, 3);
  assert.equal(result.history.deferrals.length, 1);
  assert.ok(result.history.batches[1].assignments.David[0].postedAt);
  assert.deepEqual(result.history.batches[1].assignments.Maria, h.initial.batches[1].assignments.Maria);
  assert.deepEqual(h.files.get(BASELINE_KEY), h.anchor);
  assert.ok(h.requests.filter(r => r.method === 'PUT').every(r => r.key === LEDGER_KEY));
});

test('real SDK deferral refuses unverifiable writes and missing audit events on readback', async () => {
  for (const lost of [false, true]) {
    const h = fixture();
    if (lost) h.afterPut = () => { h.files.set(LEDGER_KEY, { data: { ...clone(h.initial), revision: 12 }, etag: 'lost-event' }); };
    else h.fault = { status: 503 };
    await assert.rejects(deferCampaignAssignments({ operation: h.operation, store: h.store, now: () => '2026-11-03T19:00:00Z' }));
  }
});
