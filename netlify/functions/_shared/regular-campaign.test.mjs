import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { REGULAR_CAMPAIGN, PRIORITY_PASS, LEDGER_KEY, BASELINE_KEY, updateRegularCampaign,
  readCampaignPanel, selectRegularCampaign, validateCampaignHistory } from './regular-campaign.mjs';
import { PREPARATION_EVIDENCE } from './regular-campaign-seed.mjs';
import { loadBaseCatalog, loadCatalog } from './commerce.mjs';
import { buildSalePulseSnapshot } from './sale-pulse.mjs';
import { createAdminSalePulseHandler } from '../admin-sale-pulse.mjs';

const clone = value => structuredClone(value);
function memoryStore() {
  const files = new Map(), writes = [];
  let serial = 0;
  return {
    files, writes, failRead: false, beforeSet: null, afterSet: null,
    async getWithMetadata(key, options) {
      assert.equal(options.consistency, 'strong');
      if (this.failRead) throw Error('synthetic storage failure');
      return clone(files.get(key) || null);
    },
    async get(key, options) {
      assert.equal(options.consistency, 'strong');
      if (this.failRead) throw Error('synthetic storage failure');
      return clone(files.get(key)?.data || null);
    },
    async setJSON(key, data, options) {
      if (this.beforeSet) await this.beforeSet(key, data, options);
      const old = files.get(key);
      if ((options.onlyIfNew && old) || (options.onlyIfMatch && old?.etag !== options.onlyIfMatch)) return { modified: false };
      assert.ok(options.onlyIfNew === true || typeof options.onlyIfMatch === 'string', 'No unconditional history writes');
      const etag = `version-${++serial}`;
      files.set(key, { data: clone(data), etag }); writes.push({ key, options, data: clone(data) });
      if (this.afterSet) await this.afterSet(key, data, options);
      return { modified: true, etag };
    },
  };
}
function catalog(count = 60) {
  return {
    generatedAt: '2026-10-28T15:00:00Z',
    marketableProducts: Array.from({ length: count }, (_, i) => ({ productId: `product-${i + 1}`, itemNumber: i + 1,
      title: `Synthetic product ${i + 1}`, askingPricePYG: 100000,
      category: 'Hogar', saleMode: 'IMMEDIATE', purchasableQuantity: 1, marketabilityStatus: 'MARKETABLE',
      productUrl: `/producto/synthetic-${i + 1}`, mainImage: `/synthetic-${i + 1}.jpg`,
      views: 999 - i, cartAdds: i % 4 })),
  };
}
function harness(count = 60, evidence = []) {
  const store = memoryStore();
  let instant = '2026-10-28T15:00:00.000Z', id = 0, packet = catalog(count);
  const run = body => updateRegularCampaign({ body: { campaignId: REGULAR_CAMPAIGN, ...body },
    store, now: () => instant, idFactory: () => `synthetic-${++id}`, evidence, loadPacket: async () => clone(packet) });
  return {
    store, run, prepare: () => run({ action: 'prepare' }),
    setDay(day) { instant = `2026-11-${String(day).padStart(2, '0')}T15:00:00.000Z`; },
    setTime(value) { instant = value; },
    setPacket(value) { packet = value; }, packet: () => clone(packet),
    history: () => clone(store.files.get(LEDGER_KEY).data),
    async confirm(result, person, ids = result.packet.regularCampaign.assignments[person]) {
      return run({ action: 'confirm', cycleId: result.campaign.cycleId, batchId: result.packet.regularCampaign.batchId,
        person, productIds: ids, confirmation: 'PUBLISHED_REGULAR_CAMPAIGN' });
    },
  };
}
const selected = result => result.packet.regularCampaign.selectedProductIds;

test('new batches rank current authoritative prices descending, then Item number, without replacing pending batches', async () => {
  const h = harness(23), packet = h.packet();
  packet.marketableProducts.forEach((p, index) => { p.askingPricePYG = index < 3 ? [3500000, 1800000, 1800000][index] : 90000 + index; });
  packet.marketableProducts.reverse(); h.setPacket(packet);
  const first = await h.prepare(), original = h.history();
  assert.deepEqual(selected(first), ['product-1','product-2','product-3','product-23','product-22','product-21','product-20','product-19','product-18','product-17']);
  packet.marketableProducts.find(p => p.productId === 'product-4').askingPricePYG = 5000000;
  h.setPacket(packet); h.setDay(1);
  assert.deepEqual(selected(await h.prepare()), selected(first), 'A price change and new date do not reshuffle an unfinished batch');
  assert.deepEqual(h.history(), original);
  await h.confirm(first,'David');
  assert.deepEqual(selected(await h.prepare()), first.packet.regularCampaign.assignments.Maria);
  await h.confirm(first,'Maria');
  const second = await h.prepare();
  assert.equal(selected(second)[0], 'product-4');
  assert.ok(selected(second).every(id => !selected(first).includes(id)));
  assert.equal(second.packet.regularCampaign.passId, first.packet.regularCampaign.passId);
});

test('priority threshold is strict and marketability plus purchasable stock are required', async () => {
  const h = harness(10), packet = h.packet();
  const prices = [50001, 50000, 49999, 0, 200000, 200000, 200000, 200000, 200000, 200000];
  packet.marketableProducts.forEach((p, i) => { p.askingPricePYG = prices[i]; });
  for (const [i, status] of [[4,'SOLD'],[5,'TEMPORARILY_RESERVED'],[6,'PENDING_PAYMENT_OR_CONFIRMATION'],[7,'NOT_MARKETABLE']]) {
    packet.marketableProducts[i].marketabilityStatus = status;
  }
  packet.marketableProducts[8].purchasableQuantity = 0;
  h.setPacket(packet);
  const before = clone(packet), result = await h.prepare();
  assert.deepEqual(selected(result), ['product-10','product-1']);
  assert.equal(result.packet.regularCampaign.totalMarketable, 2);
  assert.equal(result.packet.marketableProducts.length, 10, 'Only campaign selection is filtered');
  assert.deepEqual(h.packet(), before, 'Product prices and inventory remain untouched');
});

test('real catalog override adapter and Sale Pulse determine priority eligibility from current asking prices', async () => {
  const products = await loadBaseCatalog('https://example.test');
  const original = products.find(p => p.status === 'AVAILABLE' && p.quantityRemaining > 0 && p.images?.length && p.itemNumber > 40);
  assert.ok(original);
  for (const price of [50001, 50000, 49999, 150000]) {
    const base = { ...clone(original), askingPricePYG: price > 50000 ? 10000 : 200000 };
    const authoritative = await loadCatalog('https://example.test', {
      loadBaseCatalog: async () => [base],
      listProductOverrides: async () => [{ productId: base.id, publicFields: { askingPricePYG: price } }],
      readCommittedInventory: async () => new Map(),
    });
    const packet = buildSalePulseSnapshot({ products: authoritative,
      purchasableInventory: new Map([[base.id, { product_id: base.id, capacity: base.quantityRemaining,
        committed_quantity: 0, purchasable_quantity: base.quantityRemaining, cart_held_quantity: 0, order_held_quantity: 0 }]]) }).marketingPacket;
    assert.equal(packet.marketableProducts[0].askingPricePYG, price);
    const h = harness(); h.setPacket(packet);
    if (price > 50000) assert.deepEqual(selected(await h.prepare()), [base.id]);
    else { await assert.rejects(h.prepare(), /No quedan Items elegibles/); assert.equal(h.store.writes.length, 0); }
    assert.equal(authoritative[0].askingPricePYG, price);
    assert.notEqual(base.askingPricePYG, price, 'Injected override wins over the base price');
  }
});

test('morning and afternoon advance on the same date; partial and failed-copy retries reopen the original batch', async () => {
  const h = harness(23);
  h.setTime('2026-10-30T12:00:00Z');
  const morning = await h.prepare(), writes = h.store.writes.length;
  assert.equal((await h.prepare()).packet.regularCampaign.batchId, morning.packet.regularCampaign.batchId);
  assert.equal(h.store.writes.length, writes);
  await h.confirm(morning, 'David');
  h.setTime('2026-10-30T18:00:00Z');
  const partial = await h.prepare();
  assert.equal(partial.packet.regularCampaign.batchId, morning.packet.regularCampaign.batchId);
  assert.deepEqual(selected(partial), morning.packet.regularCampaign.assignments.Maria);
  await h.confirm(morning, 'Maria');
  const afternoon = await h.prepare();
  assert.equal(h.history().batches[0].date, h.history().batches[1].date);
  assert.equal(afternoon.packet.regularCampaign.assignments.David.length, 5);
  assert.equal(afternoon.packet.regularCampaign.assignments.Maria.length, 5);
  assert.ok(selected(afternoon).every(id => !selected(morning).includes(id)));
  assert.equal((await h.prepare()).packet.regularCampaign.batchId, afternoon.packet.regularCampaign.batchId);
  await h.confirm(afternoon, 'David'); await h.confirm(afternoon, 'Maria');
  assert.deepEqual(selected(await h.prepare()), ['product-21','product-22','product-23']);
});

test('broad campaign POSTED and PREPARED records survive a concurrent priority boundary without counting as priority coverage', async () => {
  const h = harness(12, PREPARATION_EVIDENCE), broad = await h.prepare();
  await h.confirm(broad, 'David');
  const stored = h.store.files.get(LEDGER_KEY).data;
  delete stored.batches[0].passId; stored.batches[0].phase = 'PHASE_2';
  const original = h.history(), baseline = clone(h.store.files.get(BASELINE_KEY));
  const writes = h.store.writes.length;
  assert.deepEqual((await readCampaignPanel({store:h.store})).pendingBatches, []);
  assert.equal(h.store.writes.length, writes, 'Viewing does not establish the new pass');
  const [first, retry] = await Promise.all([h.prepare(), h.prepare()]);
  assert.equal(first.packet.regularCampaign.batchId, retry.packet.regularCampaign.batchId);
  assert.equal(first.packet.regularCampaign.passId, PRIORITY_PASS);
  assert.equal(first.packet.regularCampaign.passStartedAt, h.history().batches[1].preparedAt);
  assert.equal(first.packet.regularCampaign.eligibleUnconfirmedCount, 12);
  const {batches, revision, ...fixed} = h.history();
  assert.deepEqual(batches[0], original.batches[0]);
  assert.equal(batches.length, 2);
  const {batches: oldBatches, revision: oldRevision, ...oldFixed} = original;
  assert.deepEqual(fixed, oldFixed);
  assert.deepEqual(h.store.files.get(BASELINE_KEY), baseline);
  await h.confirm(broad, 'Maria'); // A true late confirmation belongs only to the old pass.
  assert.equal((await h.prepare()).packet.regularCampaign.eligibleUnconfirmedCount, 12);
  await h.confirm(first, 'David'); await h.confirm(first, 'Maria');
  const last = await h.prepare();
  assert.equal(selected(last).length, 2);
  assert.ok(selected(last).every(id => !selected(first).includes(id)));
  await h.confirm(last, 'David');
  await assert.rejects(h.prepare(), /No quedan Items elegibles/);
  assert.ok(h.history().batches[0].assignments.David.every(p => p.postedAt));
});

test('retry removes newly cheap, sold or reserved Items without changing assignments or falsely posting them', async () => {
  const h = harness(12), first = await h.prepare(), before = h.history();
  const packet = h.packet();
  packet.marketableProducts[0].askingPricePYG = 50000;
  packet.marketableProducts[1].marketabilityStatus = 'SOLD';
  packet.marketableProducts[2].marketabilityStatus = 'TEMPORARILY_RESERVED';
  h.setPacket(packet);
  assert.deepEqual(selected(await h.prepare()), selected(first).slice(3));
  assert.deepEqual(h.history(), before);
  await h.confirm(first, 'David', ['product-4','product-5']); await h.confirm(first, 'Maria');
  const last = await h.prepare();
  assert.deepEqual(selected(last), ['product-11','product-12']);
  await h.confirm(last, 'David');
  packet.marketableProducts[0].askingPricePYG = 50001;
  h.setPacket(packet); h.setDay(16);
  assert.ok(selected(await h.prepare()).includes('product-1'), 'Newly eligible and still unposted can enter later');
});

test('first pass progresses through all 83 marketable Items across days without repeats or 36-Item cutoff', async () => {
  const h = harness(83), posted = new Set();
  for (let day = 1; posted.size < 83; day++) {
    h.setDay(day);
    const batch = await h.prepare();
    assert.equal(batch.packet.regularCampaign.phase, 'FIRST_PASS');
    assert.equal(selected(batch).length, Math.min(10, 83 - posted.size));
    for (const id of selected(batch)) { assert.ok(!posted.has(id)); posted.add(id); }
    for (const person of ['David', 'Maria']) if (batch.packet.regularCampaign.assignments[person].length) await h.confirm(batch, person);
  }
  assert.equal(posted.size, 83);
  assert.ok(posted.has('product-83'));
  h.setDay(10);
  const before = h.history(), writes = h.store.writes.length;
  await assert.rejects(h.prepare(), /Reutilizá las fotos y mensajes existentes/);
  assert.deepEqual(h.history(), before);
  assert.equal(h.store.writes.length, writes);
});

test('PREPARED is not POSTED; unfinished batches reopen across dates without changing assignments', async () => {
  const h = harness(23);
  const first = await h.prepare();
  assert.ok(h.history().batches[0].assignments.David.every(p => p.postedAt === null));
  const revision = h.history().revision;
  assert.deepEqual(selected(await h.prepare()), selected(first), 'Same-day reopening is idempotent');
  assert.equal(h.history().revision, revision);
  h.setDay(1); const second = await h.prepare();
  assert.deepEqual(selected(second), selected(first));
  assert.equal(second.packet.regularCampaign.batchId, first.packet.regularCampaign.batchId);
  h.setDay(2); const third = await h.prepare();
  assert.deepEqual(selected(third), selected(first));
  assert.equal(third.packet.regularCampaign.phase, 'FIRST_PASS');
  assert.ok(selected(third).includes('product-1'), 'Prepared but unconfirmed remains in first pass');
});

test('dated unconfirmed historical baseline preserves preparation evidence without inventing past postings', async () => {
  const evidence = [{ productId:'product-1', itemNumber:1, preparedDate:'2026-10-26', source:'https://example.test/regular-desk-asset' }];
  const h = harness(12, evidence);
  const first = await h.prepare();
  const history = h.history();
  assert.equal(history.startedAt, '2026-10-28T15:00:00.000Z');
  assert.equal(history.historicalCompleteness, 'UNRECONCILED');
  assert.deepEqual(history.preparationEvidence, evidence);
  assert.ok(selected(first).includes('product-1'), 'Preparation evidence does not override price/Item ordering');
  assert.ok(history.batches.flatMap(b=>Object.values(b.assignments).flat()).every(p => p.postedAt === null));
  assert.equal(first.packet.regularCampaign.eligibleUnconfirmedCount, 12);
});

test('partial person confirmation preserves the other Items, original timestamp and idempotent retries', async () => {
  const h = harness(12), batch = await h.prepare();
  const ids = batch.packet.regularCampaign.assignments.David;
  await h.confirm(batch, 'David', ids.slice(0, 2));
  const once = h.history();
  await h.confirm(batch, 'David', ids.slice(0, 2));
  assert.deepEqual(h.history(), once);
  assert.equal(once.batches[0].assignments.David.filter(p=>p.postedAt).length, 2);
  assert.ok(once.batches[0].assignments.Maria.every(p=>p.postedAt === null));
  assert.deepEqual(selected(await h.prepare()), selected(batch).slice(2));
  h.setDay(1);
  const next = await h.prepare();
  assert.equal(next.packet.regularCampaign.eligibleUnconfirmedCount, 10);
  assert.ok(selected(next).every(id => !ids.slice(0, 2).includes(id)));
  assert.equal(next.packet.regularCampaign.batchId, batch.packet.regularCampaign.batchId);
  assert.deepEqual(selected(next), selected(batch).slice(2));
});

test('fewer than ten unconfirmed Items are never padded with confirmed repeats', async () => {
  const h = harness(12), first = await h.prepare();
  await h.confirm(first, 'David'); await h.confirm(first, 'Maria');
  h.setDay(1);
  const last = await h.prepare();
  assert.deepEqual(selected(last), ['product-11','product-12']);
  assert.deepEqual(last.packet.regularCampaign.assignments.Maria, []);
  assert.equal(last.packet.regularCampaign.phase, 'FIRST_PASS');
});

test('newly eligible unposted Items enter a completed pass after November 15 without restarting coverage', async () => {
  const h = harness(10), first = await h.prepare();
  await h.confirm(first,'David'); await h.confirm(first,'Maria');
  h.setDay(16);
  await assert.rejects(h.prepare(), /No quedan Items elegibles/);
  const packet = catalog(12);
  packet.marketableProducts[11].marketabilityStatus = 'TEMPORARILY_RESERVED';
  h.setPacket(packet);
  const newcomer = await h.prepare();
  assert.equal(newcomer.packet.regularCampaign.phase,'FIRST_PASS');
  assert.deepEqual(selected(newcomer), ['product-11']);
  assert.ok(!selected(newcomer).includes('product-12'));
});

test('price increases do not repeat confirmed Items and reduced prices leave the final batch short', async () => {
  const h = harness(15);
  let result = await h.prepare(); await h.confirm(result,'David'); await h.confirm(result,'Maria');
  const packet=h.packet(); packet.marketableProducts[0].askingPricePYG=1000000;
  packet.marketableProducts[10].askingPricePYG=50000;
  h.setPacket(packet); result=await h.prepare();
  assert.deepEqual(selected(result), ['product-12','product-13','product-14','product-15']);
  await h.confirm(result,'David');
  h.setDay(2);
  await assert.rejects(h.prepare(), /No quedan Items elegibles/);
});

test('independent posts, email delivery and analytics cannot alter campaign selection or history', async () => {
  const h=harness(50); await h.prepare(); h.setDay(1);
  const history=h.history(), packet=h.packet();
  const expected=selectRegularCampaign(packet,history,'2026-11-01T15:00:00Z');
  const changed={...packet, independentPostings:[{productId:'product-11',status:'POSTED'}],
    marketing_email_features:[{productId:'product-12',status:'SENT'}],
    marketableProducts:packet.marketableProducts.map((p,i)=>({...p,views:100000-i,cartAdds:100000-i,signals:{hotUnsold:true}}))};
  assert.deepEqual(selectRegularCampaign(changed,history,'2026-11-01T15:00:00Z').products.map(p=>p.productId), expected.products.map(p=>p.productId));
  await assert.rejects(h.run({action:'prepare',campaignId:'independent'}), /campaña regular/);
  await assert.rejects(h.run({action:'prepare',independentPostings:[]}), /campaña regular/);
  assert.deepEqual(h.history(),history);
});

test('confirmation requires an explicit publication declaration and exact cycle, batch, person and membership', async () => {
  const h=harness(), result=await h.prepare(), history=h.history();
  const base={action:'confirm',cycleId:history.cycleId,batchId:result.packet.regularCampaign.batchId,
    person:'David',productIds:['product-1'],confirmation:'PUBLISHED_REGULAR_CAMPAIGN'};
  for(const override of [{confirmation:'APPROVED'},{confirmation:'DOWNLOADED'},{confirmation:'PREPARED'},
    {cycleId:'old-cycle'},{person:'independent'},{productIds:['product-6']},{productIds:['product-1','product-1']},
    {batchId:'missing'},{productIds:[]},{campaignId:'independent'}]) {
    await assert.rejects(h.run({...base,...override}));
  }
  assert.deepEqual(h.history(),history);
});

test('conditional writes preserve concurrent partial confirmations and cross-session preparation', async () => {
  const h=harness(), batch=await h.prepare();
  await Promise.all([h.confirm(batch,'David',['product-1']),h.confirm(batch,'Maria',['product-6'])]);
  const history=h.history();
  assert.ok(history.batches[0].assignments.David[0].postedAt);
  assert.ok(history.batches[0].assignments.Maria[0].postedAt);
  h.setDay(1);
  const [a,b]=await Promise.all([h.prepare(),h.prepare()]);
  assert.equal(a.packet.regularCampaign.batchId,b.packet.regularCampaign.batchId);
  assert.equal(a.packet.regularCampaign.batchId,batch.packet.regularCampaign.batchId);
  assert.equal(h.history().batches.length,1);
  assert.ok(h.store.writes.filter(w=>w.key===LEDGER_KEY).slice(1).every(w=>w.options.onlyIfMatch));
});

test('missing/corrupt active history or storage errors fail closed without resetting confirmed coverage', async () => {
  const h=harness(), batch=await h.prepare(); await h.confirm(batch,'David');
  const original=h.history(), writes=h.store.writes.length;
  h.store.failRead=true;
  await assert.rejects(h.prepare()); assert.equal(h.store.writes.length,writes);
  h.store.failRead=false;
  h.store.files.get(LEDGER_KEY).data.campaignId='independent';
  await assert.rejects(h.prepare(), /no fiable/);
  h.store.files.get(LEDGER_KEY).data=original;
  h.store.files.delete(LEDGER_KEY);
  await assert.rejects(h.prepare(), /Falta el historial del ciclo activo/);
  assert.equal(h.store.writes.length,writes);
  assert.ok(h.store.files.has(BASELINE_KEY));
});

test('initial read is passive and uncertain historical data never halts a valid initialized cycle', async () => {
  const h=harness();
  assert.equal((await readCampaignPanel({store:h.store})).status,'UNINITIALIZED');
  assert.equal(h.store.writes.length,0);
  await h.prepare();
  assert.equal((await readCampaignPanel({store:h.store})).historicalCompleteness,'UNRECONCILED');
  assert.doesNotThrow(()=>validateCampaignHistory(h.history()));
});

test('historical preparation evidence stays intact without overriding stable Item ordering', async () => {
  const evidence=[
    {productId:'product-1',itemNumber:1,preparedDate:'2026-10-27',source:'synthetic-newest'},
    {productId:'product-2',itemNumber:2,preparedDate:'2026-10-25',source:'synthetic-other'},
    {productId:'product-1',itemNumber:1,preparedDate:'2026-10-21',source:'synthetic-oldest'},
  ];
  const h=harness(12,evidence), result=await h.prepare();
  assert.deepEqual(selected(result),Array.from({length:10},(_,i)=>`product-${i+1}`));
  await h.confirm(result, 'David'); await h.confirm(result, 'Maria');
  h.setDay(1);
  const next=await h.prepare();
  assert.deepEqual(selected(next),['product-11','product-12']);
  assert.deepEqual(h.history().preparationEvidence, evidence);
});

test('failure after baseline creation is recoverable with the original cycle and passive GETs', async () => {
  const h=harness();
  h.store.beforeSet=async (key,data)=>{
    if(key===LEDGER_KEY && data.initialization==='ESTABLISHED')throw Error('interrupted write');
  };
  await assert.rejects(h.prepare(),/interrupted write/);
  const provisional=h.history(), baseline=clone(h.store.files.get(BASELINE_KEY).data);
  assert.equal(provisional.initialization,'PROVISIONAL');
  assert.equal(provisional.cycleId,baseline.cycleId);
  assert.equal(h.store.writes.length,2);
  const before=clone(h.store.files);
  assert.equal((await readCampaignPanel({store:h.store})).status,'UNINITIALIZED');
  assert.deepEqual(h.store.files,before);
  assert.equal(h.store.writes.length,2,'GET cannot finish initialization');
  await assert.rejects(h.run({action:'confirm',cycleId:provisional.cycleId,batchId:provisional.batches[0].id,
    person:'David',productIds:['product-1'],confirmation:'PUBLISHED_REGULAR_CAMPAIGN'}), /todavía no está completa/);
  h.store.beforeSet=null;
  const recovered=await h.prepare();
  assert.equal(recovered.campaign.cycleId,baseline.cycleId);
  assert.equal(recovered.campaign.startedAt,baseline.startedAt);
  assert.deepEqual(h.history(),{...provisional,initialization:'ESTABLISHED'});
  assert.equal(h.store.writes.length,3);
  assert.ok(h.store.writes[2].options.onlyIfMatch);
  assert.deepEqual(selected(recovered),Array.from({length:10},(_,i)=>`product-${i+1}`));
});

test('concurrent first initialization converges on one cycle, anchor and initial batch', async () => {
  const h=harness();
  const results=await Promise.all(Array.from({length:8},()=>h.prepare()));
  const history=h.history();
  assert.equal(history.initialization,'ESTABLISHED');
  assert.equal(history.batches.length,1);
  assert.ok(results.every(r=>r.campaign.cycleId===history.cycleId && r.packet.regularCampaign.batchId===history.batches[0].id));
  assert.ok(results.every(r=>JSON.stringify(selected(r))===JSON.stringify(selected(results[0]))));
  assert.equal(h.store.writes.length,3);
  assert.ok(h.store.writes.every(w=>w.data.cycleId===history.cycleId));
  assert.equal(h.store.writes.filter(w=>w.key===BASELINE_KEY).length,1);
});

test('repeated failures during initialization recovery remain safely retryable', async () => {
  const h=harness();
  h.store.beforeSet=async (key,data)=>{
    if(key===LEDGER_KEY && data.initialization==='ESTABLISHED')throw Error('temporary activation failure');
  };
  await assert.rejects(h.prepare(),/temporary activation failure/);
  const initial=clone(h.store.files), identity=h.history().cycleId;
  await assert.rejects(h.prepare(),/temporary activation failure/);
  assert.deepEqual(h.store.files,initial);
  assert.equal(h.store.writes.length,2);
  h.store.beforeSet=null;
  const recovered=await h.prepare();
  assert.equal(recovered.campaign.cycleId,identity);
  assert.equal(h.history().revision,1);
  assert.ok(h.history().batches[0].assignments.David.every(p=>p.postedAt===null));
});

test('failure before anchor creation is recoverable without replacing provisional history', async () => {
  const h=harness();
  h.store.beforeSet=async key=>{if(key===BASELINE_KEY)throw Error('anchor unavailable');};
  await assert.rejects(h.prepare(),/anchor unavailable/);
  const provisional=h.history();
  assert.equal(provisional.initialization,'PROVISIONAL');
  assert.equal(h.store.files.has(BASELINE_KEY),false);
  assert.equal((await readCampaignPanel({store:h.store})).status,'UNINITIALIZED');
  assert.equal(h.store.writes.length,1);
  h.store.beforeSet=null;
  await h.prepare();
  assert.deepEqual(h.history(),{...provisional,initialization:'ESTABLISHED'});
});

test('an uncertain successful activation is not replayed over later publication confirmations', async () => {
  const h=harness();
  h.store.afterSet=async (key,data)=>{
    if(key===LEDGER_KEY && data.initialization==='ESTABLISHED')throw Error('response lost after commit');
  };
  await assert.rejects(h.prepare(),/response lost after commit/);
  const established=h.history();
  assert.equal(established.initialization,'ESTABLISHED');
  h.store.afterSet=null;
  const recovered=await h.prepare();
  assert.equal(recovered.campaign.cycleId,established.cycleId);
  await h.confirm(recovered,'David',['product-1']);
  const confirmed=h.history(), writes=h.store.writes.length;
  const retry=await h.prepare();
  assert.ok(!selected(retry).includes('product-1'));
  assert.deepEqual(h.history(),confirmed);
  assert.equal(h.store.writes.length,writes);
});

for(const loseHistory of [false,true]) test(`stale activation cannot ${loseHistory?'recreate missing established history':'overwrite established confirmations'}`,{timeout:5000},async()=>{
  const h=harness();
  let release, reached, paused=false;
  const gate=new Promise(resolve=>{release=resolve;}), waiting=new Promise(resolve=>{reached=resolve;});
  h.store.beforeSet=async(key,data)=>{
    if(key===LEDGER_KEY && data.initialization==='ESTABLISHED' && !paused) {
      paused=true; reached(); await gate;
    }
  };
  const slow=h.prepare();
  await waiting;
  const fast=await h.prepare();
  await h.confirm(fast,'David',['product-1']);
  const confirmed=h.history(), writes=h.store.writes.length;
  if(loseHistory)h.store.files.delete(LEDGER_KEY);
  release();
  if(loseHistory) {
    await assert.rejects(slow,/Falta el historial del ciclo activo/);
    assert.equal(h.store.files.has(LEDGER_KEY),false);
  } else {
    assert.ok(!selected(await slow).includes('product-1'));
    assert.deepEqual(h.history(),confirmed);
  }
  assert.equal(h.store.writes.length,writes);
});

test('legacy established histories stay intact; loss, corruption and ambiguous baseline-only state fail closed', async () => {
  const h=harness(), prepared=await h.prepare();
  await h.confirm(prepared,'David',['product-1']);
  delete h.store.files.get(LEDGER_KEY).data.initialization;
  const legacy=clone(h.store.files.get(LEDGER_KEY)), writes=h.store.writes.length;
  assert.ok(!selected(await h.prepare()).includes('product-1'));
  assert.deepEqual(h.store.files.get(LEDGER_KEY),legacy);
  h.store.files.get(LEDGER_KEY).data.initialization='PROVISIONAL';
  await assert.rejects(h.prepare(),/no fiable/);
  h.store.files.set(LEDGER_KEY,clone(legacy));
  h.store.files.get(LEDGER_KEY).data.batches[0].assignments.David[0].postedAt='corrupted';
  await assert.rejects(h.prepare(),/no fiable/);
  h.store.files.delete(LEDGER_KEY);
  await assert.rejects(h.prepare(),/Falta el historial del ciclo activo/);
  await assert.rejects(readCampaignPanel({store:h.store}),/Falta el historial del ciclo activo/);
  assert.equal(h.store.files.has(LEDGER_KEY),false);
  assert.equal(h.store.writes.length,writes);
});

test('recovered preparation still revalidates current marketability without changing the original cycle', async () => {
  const h=harness();
  h.store.beforeSet=async(key,data)=>{
    if(key===LEDGER_KEY && data.initialization==='ESTABLISHED')throw Error('interrupted');
  };
  await assert.rejects(h.prepare(),/interrupted/);
  const cycle=h.history().cycleId, packet=h.packet();
  packet.marketableProducts[0].marketabilityStatus='TEMPORARILY_RESERVED';
  h.setPacket(packet); h.store.beforeSet=null;
  const recovered=await h.prepare();
  assert.equal(recovered.campaign.cycleId,cycle);
  assert.ok(!selected(recovered).includes('product-1'));
  assert.equal(selected(recovered).length,9);
});

test('incomplete eligible product data cannot silently declare coverage complete', async () => {
  const h=harness(2), packet=h.packet(); packet.marketableProducts[1].mainImage=null; h.setPacket(packet);
  await assert.rejects(h.prepare(), /Faltan datos completos/);
  assert.equal(h.store.writes.length,0);
});

test('Desk preparation evidence uses stable catalog IDs and does not contain publication claims', async () => {
  const products=await loadBaseCatalog('https://synthetic.test');
  assert.equal(new Set(PREPARATION_EVIDENCE.map(p=>p.productId)).size,51);
  for(const entry of PREPARATION_EVIDENCE) {
    assert.equal(products.find(p=>p.id===entry.productId)?.itemNumber,entry.itemNumber);
    assert.match(entry.source,/^https:\/\/drive\.google\.com\/file\/d\//);
    assert.equal(entry.postedAt,undefined);
  }
});

function request(body,method='POST') {
  return new Request('https://example.test/api/admin/sale-pulse',{method,
    ...(body ? {headers:{'content-type':'application/json'},body:JSON.stringify(body)} : {})});
}
test('existing endpoint authenticates campaign mutations first and supports no independent-post action', async () => {
  let writes=0;
  const denied=createAdminSalePulseHandler({authorized:()=>false,updateCampaign:async()=>{writes++;}});
  assert.equal((await denied(request({action:'prepare',campaignId:REGULAR_CAMPAIGN}))).status,401);
  assert.equal(writes,0);
  const h=harness();
  const handler=createAdminSalePulseHandler({authorized:()=>true,loadSnapshot:async()=>({marketingPacket:h.packet()}),
    loadCampaign:()=>readCampaignPanel({store:h.store}),updateCampaign:args=>updateRegularCampaign({...args,store:h.store,
      now:()=> '2026-10-28T15:00:00Z',idFactory:()=>`endpoint-${++writes}`,evidence:[]})});
  assert.equal((await handler(request({action:'post-independent',campaignId:'independent'}))).status,400);
  const prepared=await (await handler(request({action:'prepare',campaignId:REGULAR_CAMPAIGN}))).json();
  assert.equal(prepared.salePulse.marketingPacket.regularCampaign.selectedProductIds.length,10);
  const before=clone(h.store.files);
  const viewed=await (await handler(request(null,'GET'))).json();
  assert.equal(viewed.salePulse.regularCampaign.status,'READY');
  assert.deepEqual(h.store.files,before,'Viewing makes no campaign write');
});

test('history read failure leaves Sale Pulse inventory readable while prepare fails', async () => {
  const handler=createAdminSalePulseHandler({authorized:()=>true,loadSnapshot:async()=>({marketingPacket:catalog()}),
    loadCampaign:async()=>{throw Error('unavailable');},updateCampaign:async()=>{throw Object.assign(Error('history unavailable'),{status:409});}});
  const read=await (await handler(request(null,'GET'))).json();
  assert.equal(read.salePulse.regularCampaign.status,'UNAVAILABLE');
  assert.equal(read.salePulse.marketingPacket.marketableProducts.length,60);
  assert.equal((await handler(request({action:'prepare',campaignId:REGULAR_CAMPAIGN}))).status,409);
});

test('server selection and persistence never import operational writes or email delivery', async () => {
  const source=await readFile(new URL('./regular-campaign.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/inventory-database|marketing-email|seller-notifications|saveProduct|loadCatalog/);
  assert.match(source,/onlyIfMatch/);
});

test('actual clipboard handler uses the authenticated endpoint and persisted history for morning and afternoon', async () => {
  const store=memoryStore(), copied=[];
  let instant='2026-10-28T15:00:00Z', sequence=0;
  const handler=createAdminSalePulseHandler({authorized:req=>req.headers.get('x-admin-token')==='synthetic',
    loadSnapshot:async()=>({marketingPacket:catalog(50)}),
    updateCampaign:args=>updateRegularCampaign({...args,store,now:()=>instant,idFactory:()=>`wire-${++sequence}`,evidence:[]})});
  const source=await readFile(new URL('../../../js/admin.js',import.meta.url),'utf8');
  const context={URL,Headers,Blob,console,setTimeout,document:{getElementById:()=>null},
    window:{addEventListener(){},location:{pathname:'/admin'}},navigator:{clipboard:{writeText:async text=>copied.push(text)}},
    fetch:(url,options)=>handler(new Request(new URL(url,'https://example.test'),options))};
  runInNewContext(source+'\n;ADMIN_STATE.token="synthetic"; globalThis.copy=copySalePulseForChatgpt;',context);
  await context.copy({currentTarget:{disabled:false,textContent:''}});
  assert.equal(copied.length,1);
  const data=JSON.parse(copied[0].match(/\nCANDIDATOS_JSON\n([^\n]+)\nFIN_CANDIDATOS_JSON/)[1]);
  assert.deepEqual(data.candidates.map(p=>p.productId),Array.from({length:10},(_,i)=>`product-${i+1}`));
  for(const person of ['David','Maria']) {
    const response=await handler(request({action:'confirm',campaignId:REGULAR_CAMPAIGN,cycleId:data.regularCampaign.cycleId,
      batchId:data.regularCampaign.batchId,person,productIds:data.regularCampaign.assignments[person],confirmation:'PUBLISHED_REGULAR_CAMPAIGN'}));
    // The direct fixture request must authenticate just like the UI request.
    assert.equal(response.status,401);
    const authenticated=request({action:'confirm',campaignId:REGULAR_CAMPAIGN,cycleId:data.regularCampaign.cycleId,
      batchId:data.regularCampaign.batchId,person,productIds:data.regularCampaign.assignments[person],confirmation:'PUBLISHED_REGULAR_CAMPAIGN'});
    authenticated.headers.set('x-admin-token','synthetic');
    assert.equal((await handler(authenticated)).status,200);
  }
  instant='2026-10-28T20:00:00Z';
  await context.copy({currentTarget:{disabled:false,textContent:''}});
  const next=JSON.parse(copied[1].match(/\nCANDIDATOS_JSON\n([^\n]+)\nFIN_CANDIDATOS_JSON/)[1]);
  assert.deepEqual(next.candidates.map(p=>p.productId),Array.from({length:10},(_,i)=>`product-${i+11}`));
  assert.ok(copied.every(text=>text.length<=18000 && text.endsWith('FIN DEL PAQUETE MOVIL')));
});
