import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// Load the real locked SDK with its documented test retry delay (six actual attempts).
const priorNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { getStore } = await import('@netlify/blobs');
const { REGULAR_CAMPAIGN, PRIORITY_PASS, LEDGER_KEY, BASELINE_KEY, updateRegularCampaign, readCampaignPanel } = await import('./regular-campaign.mjs');
const { createAdminSalePulseHandler } = await import('../admin-sale-pulse.mjs');
if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = priorNodeEnv;

const clone = value => structuredClone(value);
const isPosted = data => data?.batches?.some(b => Object.values(b.assignments).flat().some(p => p.postedAt));
const matchesStage = (stage, key, data) => stage === 'initial' ? key === LEDGER_KEY && data.initialization === 'PROVISIONAL'
  : stage === 'baseline' ? key === BASELINE_KEY
  : stage === 'activation' ? key === LEDGER_KEY && data.initialization === 'ESTABLISHED' && data.revision === 1
  : stage === 'preparation' ? key === LEDGER_KEY && data.initialization === 'ESTABLISHED' && data.batches.length > 1
  : stage === 'confirmation' && key === LEDGER_KEY && isPosted(data);

function sdkFixture(count = 12) {
  const files = new Map(), requests = [];
  let version = 0, identity = 0, instant = '2026-10-28T15:00:00.000Z';
  const fixture = { files, requests, fault: null, afterPut: null, readFault: null };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'campaign.test.invalid', 'All SDK requests must remain inside the injected transport');
    const key = decodeURIComponent(url.pathname.split('/').at(-1));
    const method = options.method.toUpperCase(), headers = new Headers(options.headers);
    const data = method === 'PUT' ? JSON.parse(options.body) : undefined;
    requests.push({ key, method, headers, data: clone(data) });
    if (method === 'GET') {
      if (fixture.readFault) {
        const failure = await fixture.readFault(key);
        if (failure) return new Response('synthetic read failure', { status: failure });
      }
      const file = files.get(key);
      return file ? new Response(JSON.stringify(file.data), { status: 200, headers: { etag: file.etag, 'content-type': 'application/json' } })
        : new Response(null, { status: 404 });
    }
    assert.equal(method, 'PUT');
    assert.ok(headers.has('if-match') || headers.get('if-none-match') === '*', 'Every SDK write must remain conditional');
    const fault = fixture.fault?.when(key, data, headers) ? fixture.fault : null;
    if (fault && fault.status !== 200) return new Response('synthetic rejected write', { status: fault.status,
      headers: fault.etag ? { etag: fault.etag } : {} });
    const old = files.get(key);
    if ((headers.get('if-none-match') === '*' && old) ||
        (headers.has('if-match') && old?.etag !== headers.get('if-match'))) return new Response(null, { status: 412 });
    const etag = `"sdk-version-${++version}"`;
    if (!fault || fault.commit !== false) files.set(key, { data: clone(data), etag });
    if (fixture.afterPut) await fixture.afterPut(key, data);
    const responseEtag = fault && Object.hasOwn(fault, 'etag') ? fault.etag : etag;
    return new Response(null, { status: 200, headers: typeof responseEtag === 'string' ? { etag: responseEtag } : {} });
  };
  // Reads, writes, retry logic, conditional headers and return shapes all use the real SDK.
  fixture.store = getStore({ name: 'synthetic-regular-campaign', siteID: 'synthetic-site', token: 'synthetic-token',
    edgeURL: 'https://campaign.test.invalid', uncachedEdgeURL: 'https://campaign.test.invalid',
    consistency: 'strong', fetch: fetchImpl });
  fixture.packet = () => ({ generatedAt: instant, marketableProducts: Array.from({ length: count }, (_, i) => ({
    productId: `synthetic-${i + 1}`, itemNumber: i + 1, title: `Synthetic ${i + 1}`, askingPricePYG: 100000,
    category: 'Hogar', saleMode: 'IMMEDIATE', purchasableQuantity: 1, marketabilityStatus: 'MARKETABLE',
    productUrl: `/producto/synthetic-${i + 1}`, mainImage: `/synthetic-${i + 1}.jpg`,
  })) });
  fixture.run = body => updateRegularCampaign({ body: { campaignId: REGULAR_CAMPAIGN, ...body }, store: fixture.store,
    now: () => instant, idFactory: () => `sdk-id-${++identity}`, evidence: [], loadPacket: async () => fixture.packet() });
  fixture.prepare = () => fixture.run({ action: 'prepare' });
  fixture.confirmBody = (batch, person = 'David', productIds = batch.packet.regularCampaign.assignments[person]) => ({
    action: 'confirm', campaignId: REGULAR_CAMPAIGN, cycleId: batch.campaign.cycleId,
    batchId: batch.packet.regularCampaign.batchId, person, productIds, confirmation: 'PUBLISHED_REGULAR_CAMPAIGN',
  });
  fixture.confirm = (batch, person, ids) => fixture.run(fixture.confirmBody(batch, person, ids));
  fixture.history = () => clone(files.get(LEDGER_KEY)?.data);
  fixture.nextDay = () => { instant = '2026-10-29T15:00:00.000Z'; };
  fixture.rejectStage = (stage, status, extras = {}) => {
    fixture.fault = { when: (key, data) => matchesStage(stage, key, data), status, ...extras };
  };
  return fixture;
}

const uncertain = error => error.status === 503 && /verificar la escritura/.test(error.message);
const pending = (panel, id) => panel.pendingBatches.some(b => Object.values(b.assignments).flat().some(p => p.productId === id));

test('the fixture exercises the locked @netlify/blobs 11.1.0 rather than an upgraded or mocked SDK', async () => {
  const lock = JSON.parse(await readFile(new URL('../../../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages['node_modules/@netlify/blobs'].version, '11.1.0');
  const h = sdkFixture();
  const prepared = await h.prepare();
  assert.equal(prepared.campaign.status, 'READY');
  assert.equal(h.history().initialization, 'ESTABLISHED');
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 3);
  assert.ok(h.requests.filter(r => r.method === 'GET').length > 3, 'Persistence is verified through SDK strong reads');
});

test('real SDK priority boundary survives a rejected write and preserves broad POSTED history and anchor', async () => {
  const h = sdkFixture(2), broad = await h.prepare();
  await h.confirm(broad, 'David');
  delete h.files.get(LEDGER_KEY).data.batches[0].passId;
  const before = h.history(), baseline = clone(h.files.get(BASELINE_KEY));
  h.fault = { when: (key, data) => key === LEDGER_KEY && data.batches.length === 2, status: 403 };
  await assert.rejects(h.prepare(), uncertain);
  assert.deepEqual(h.history(), before);
  h.fault = null;
  const priority = await h.prepare();
  assert.equal(priority.packet.regularCampaign.passId, PRIORITY_PASS);
  assert.deepEqual(priority.packet.regularCampaign.selectedProductIds, ['synthetic-1','synthetic-2']);
  assert.deepEqual(h.history().batches[0], before.batches[0]);
  assert.deepEqual(h.files.get(BASELINE_KEY), baseline);
  await h.confirm(priority, 'David');
  const complete = h.history();
  await assert.rejects(h.prepare(), /No quedan Items elegibles/);
  assert.deepEqual(h.history(), complete);
});

for (const status of [403, 503]) for (const condition of ['onlyIfNew', 'onlyIfMatch']) {
  test(`real SDK reproduces HTTP ${status} phantom success for ${condition}`, async () => {
    const h = sdkFixture();
    h.fault = { when: () => true, status };
    const result = await h.store.setJSON(LEDGER_KEY, { synthetic: true },
      condition === 'onlyIfNew' ? { onlyIfNew: true } : { onlyIfMatch: '"expected"' });
    assert.deepEqual(result, { etag: '', modified: true });
    assert.equal(h.files.size, 0);
    assert.equal(h.requests.filter(r => r.method === 'PUT').length, status === 503 ? 6 : 1);
  });
}

for (const status of [403, 503]) for (const stage of ['initial', 'baseline', 'activation']) {
  test(`HTTP ${status} ${stage} write cannot acknowledge an initialized cycle and remains retryable`, async () => {
    const h = sdkFixture();
    h.rejectStage(stage, status);
    await assert.rejects(h.prepare(), uncertain);
    assert.equal(h.requests.filter(r => r.method === 'PUT' && matchesStage(stage, r.key, r.data)).length,
      status === 503 ? 6 : 1);
    if (stage === 'initial') assert.equal(h.files.size, 0);
    else {
      assert.equal(h.history().initialization, 'PROVISIONAL');
      assert.equal(isPosted(h.history()), false);
    }
    assert.equal((await readCampaignPanel({ store: h.store })).status, 'UNINITIALIZED');
    const identity = h.history()?.cycleId;
    h.fault = null;
    const recovered = await h.prepare();
    assert.equal(recovered.campaign.status, 'READY');
    if (identity) assert.equal(recovered.campaign.cycleId, identity);
    assert.equal(h.history().initialization, 'ESTABLISHED');
    assert.equal(isPosted(h.history()), false);
  });
}

for (const status of [403, 503]) test(`critical: rejected HTTP ${status} confirmation never returns POSTED success`, async () => {
  const h = sdkFixture(2), prepared = await h.prepare(), before = h.history();
  h.rejectStage('confirmation', status);
  const handler = createAdminSalePulseHandler({ authorized: () => true,
    updateCampaign: ({ body }) => h.run(body) });
  const response = await handler(new Request('https://example.test/api/admin/sale-pulse', {
    method: 'POST', body: JSON.stringify(h.confirmBody(prepared, 'David', ['synthetic-1'])),
  }));
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.ok, undefined);
  assert.equal(result.campaign, undefined);
  assert.deepEqual(h.history(), before);
  assert.ok(pending(await readCampaignPanel({ store: h.store }), 'synthetic-1'));
  assert.equal(h.requests.filter(r => r.method === 'PUT' && matchesStage('confirmation', r.key, r.data)).length,
    status === 503 ? 6 : 1);
  h.fault = null; h.nextDay();
  const next = await h.prepare();
  assert.equal(next.packet.regularCampaign.phase, 'FIRST_PASS');
  assert.equal(next.packet.regularCampaign.eligibleUnconfirmedCount, 2);
  assert.ok(next.packet.regularCampaign.selectedProductIds.includes('synthetic-1'));
  await h.confirm(next, 'David', ['synthetic-1']);
  assert.ok(!pending(await readCampaignPanel({ store: h.store }), 'synthetic-1'));
});

for (const status of [403, 503]) test(`HTTP ${status} later preparation does not advance the durable campaign history`, async () => {
  const h = sdkFixture();
  const first = await h.prepare(); await h.confirm(first, 'David'); await h.confirm(first, 'Maria'); h.nextDay();
  const before = h.history();
  h.rejectStage('preparation', status);
  await assert.rejects(h.prepare(), uncertain);
  assert.deepEqual(h.history(), before);
  assert.equal(h.requests.filter(r => r.method === 'PUT' && matchesStage('preparation', r.key, r.data)).length,
    status === 503 ? 6 : 1);
  h.fault = null;
  const next = await h.prepare();
  assert.equal(h.history().batches.length, 2);
  assert.equal(next.packet.regularCampaign.phase, 'FIRST_PASS');
  assert.deepEqual(next.packet.regularCampaign.selectedProductIds.slice(0, 2), ['synthetic-11', 'synthetic-12']);
});

test('real SDK keeps genuine 412 conflicts distinct from invalid provider success', async () => {
  const h = sdkFixture(), prepared = await h.prepare();
  const initial = await h.store.setJSON(LEDGER_KEY, {}, { onlyIfNew: true });
  const mismatch = await h.store.setJSON(LEDGER_KEY, {}, { onlyIfMatch: '"stale"' });
  assert.deepEqual(initial, { modified: false });
  assert.deepEqual(mismatch, { modified: false });
  let remaining = 1;
  h.fault = { when: (key, data) => matchesStage('confirmation', key, data) && remaining-- > 0, status: 412 };
  const confirmed = await h.confirm(prepared, 'David', ['synthetic-1']);
  assert.ok(!pending(confirmed.campaign, 'synthetic-1'));
  assert.ok(h.history().batches[0].assignments.David[0].postedAt);
});

for (const etag of [undefined, '', ' ', '*', 'W/"weak"', '"unterminated']) {
  test(`a successful SDK response with invalid write ETag ${JSON.stringify(etag)} is not acknowledged`, async () => {
    const h = sdkFixture(), prepared = await h.prepare();
    h.rejectStage('confirmation', 200, { etag });
    await assert.rejects(h.confirm(prepared, 'David', ['synthetic-1']), uncertain);
    const committed = h.history();
    assert.ok(committed.batches[0].assignments.David[0].postedAt, 'An uncertain but committed write is never erased');
    h.fault = null;
    const writes = h.requests.filter(r => r.method === 'PUT').length;
    const retried = await h.confirm(prepared, 'David', ['synthetic-1']);
    assert.ok(!pending(retried.campaign, 'synthetic-1'));
    assert.deepEqual(h.history(), committed);
    assert.equal(h.requests.filter(r => r.method === 'PUT').length, writes, 'Retry acknowledges already durable history without rewriting');
  });
}

for (const stage of ['initial', 'baseline', 'activation', 'confirmation']) {
  test(`${stage} success with a plausible ETag still requires authoritative durable readback`, async () => {
    const h = sdkFixture();
    const prepared = stage === 'confirmation' ? await h.prepare() : null;
    h.rejectStage(stage, 200, { etag: '"plausible-but-not-persisted"', commit: false });
    await assert.rejects(prepared ? h.confirm(prepared, 'David', ['synthetic-1']) : h.prepare(), uncertain);
    if (stage === 'initial') assert.equal(h.files.size, 0);
    else if (stage === 'confirmation') assert.ok(pending(await readCampaignPanel({ store: h.store }), 'synthetic-1'));
    else assert.equal(h.history().initialization, 'PROVISIONAL');
  });
}

test('readback accepts a newer ETag/revision with legitimate concurrent confirmations', async () => {
  const h = sdkFixture(), prepared = await h.prepare();
  let fired = false;
  h.afterPut = async (key, data) => {
    if (!fired && key === LEDGER_KEY && isPosted(data)) {
      fired = true;
      await h.confirm(prepared, 'Maria', ['synthetic-6']);
    }
  };
  const confirmed = await h.confirm(prepared, 'David', ['synthetic-1']);
  assert.equal(confirmed.campaign.revision, 3);
  assert.ok(!pending(confirmed.campaign, 'synthetic-1'));
  assert.ok(!pending(confirmed.campaign, 'synthetic-6'));
  assert.ok(h.history().batches[0].assignments.David[0].postedAt);
  assert.ok(h.history().batches[0].assignments.Maria[0].postedAt);
});

test('a newer legitimate concurrent confirmation does not prove that a rejected requested write persisted', async () => {
  const h = sdkFixture(), prepared = await h.prepare();
  h.rejectStage('confirmation', 200, { etag: '"plausible-but-rejected"', commit: false });
  let fired = false;
  h.afterPut = async (key, data) => {
    if (!fired && key === LEDGER_KEY && isPosted(data)) {
      fired = true; h.fault = null;
      await h.confirm(prepared, 'Maria', ['synthetic-6']);
    }
  };
  await assert.rejects(h.confirm(prepared, 'David', ['synthetic-1']), uncertain);
  const panel = await readCampaignPanel({ store: h.store });
  assert.equal(panel.revision, 2);
  assert.ok(pending(panel, 'synthetic-1'));
  assert.ok(!pending(panel, 'synthetic-6'));
});

test('real SDK CAS retries preserve simultaneous confirmations and confirmed timestamps', async () => {
  const h = sdkFixture(), prepared = await h.prepare();
  await Promise.all([h.confirm(prepared, 'David', ['synthetic-1']), h.confirm(prepared, 'Maria', ['synthetic-6'])]);
  const before = h.history();
  assert.ok(before.batches[0].assignments.David[0].postedAt);
  assert.ok(before.batches[0].assignments.Maria[0].postedAt);
  await h.confirm(prepared, 'David', ['synthetic-1']);
  assert.deepEqual(h.history(), before);
});

test('an unavailable strong readback fails safely even after the write actually committed', async () => {
  const h = sdkFixture(), prepared = await h.prepare();
  h.afterPut = async (key, data) => { if (key === LEDGER_KEY && isPosted(data)) h.readFault = () => 403; };
  await assert.rejects(h.confirm(prepared, 'David', ['synthetic-1']));
  const before = h.history();
  assert.ok(before.batches[0].assignments.David[0].postedAt);
  h.readFault = null; h.afterPut = null;
  const confirmed = await h.confirm(prepared, 'David', ['synthetic-1']);
  assert.ok(!pending(confirmed.campaign, 'synthetic-1'));
  assert.deepEqual(h.history(), before);
});

test('loss or corruption of established real-SDK history cannot produce a replacement cycle', async () => {
  const h = sdkFixture(), prepared = await h.prepare();
  await h.confirm(prepared, 'David', ['synthetic-1']);
  const before = clone(h.files.get(LEDGER_KEY)), puts = h.requests.filter(r => r.method === 'PUT').length;
  h.files.get(LEDGER_KEY).data.batches[0].assignments.David[0].postedAt = 'corrupted';
  await assert.rejects(h.prepare(), /no fiable/);
  h.files.set(LEDGER_KEY, before); h.files.delete(LEDGER_KEY);
  await assert.rejects(h.prepare(), /Falta el historial del ciclo activo/);
  assert.ok(h.files.has(BASELINE_KEY));
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, puts);
});
