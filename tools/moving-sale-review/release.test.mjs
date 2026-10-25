import test from 'node:test';
import assert from 'node:assert/strict';
import { active, applyTiming, approvedSelection, approvedHandoff, auditRoundTrip, finalizedProduct, pricingResearch } from './core.mjs';
import { appendVolume5Batch, planAdditiveCatalog, releaseCandidate } from './release.mjs';
import { catalogBatchProducts } from '../../netlify/functions/_shared/volume2-public.mjs';
import { loadCatalog } from '../../netlify/functions/_shared/commerce.mjs';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { activationPatch } from './release.mjs';

const held = [512, 514, 604];
function sample() {
  const sources = [], items = [];
  for (let n = 510; n <= 614; n++) {
    const photo = { sourceId: `source-${n}`, path: `images/volume-5/v5-source-${n}.webp`, role: 'public', justification: '' };
    sources.push({ sourceId: photo.sourceId, filename: `photo-${n}.jpg`, optimizedPath: photo.path });
    const product = { itemNumber: n, id: `real-202610-volume5-${n}`, slug: `articulo-item-${n}`, title: 'Artículo de prueba', category: 'Hogar', asking: 10000, description: 'Artículo de prueba.', condition: 'Buena condición.', knownDefects: 'No', functionality: 'No aplica', measurements: '', quantityTotal: 1, saleMode: n === 510 ? 'DELAYED' : 'IMMEDIATE', saleStructure: 'individual', includedAccessories: ['Tapa'], notIncludedVisible: 'Objeto decorativo', requiresVehicle: false, requiresLoadingHelp: false, status: 'NEEDS_REVIEW', needsReview: true };
    applyTiming(product);
    items.push({ product, initialProduct: structuredClone(product), photos: [photo], coverSourceId: photo.sourceId, reviewStatus: held.includes(n) ? 'missing' : 'approved', questions: [], groupingConfirmed: true, copyChecked: true, confirmedFields: [], pricing: pricingResearch(), ownerNotes: 'Privado', pricingDecision: 'Privado', retired: false });
  }
  return { schemaVersion: 1, volume: 5, mode: 'real', publicationAllowed: false, batchId: 'volume5-release-test', revision: 10, items, sources, events: [], retiredItemNumbers: [] };
}
test('approved-only release exports exactly 102, holds 512/514/604, and never mutates 105 records', () => {
  const state = sample(), before = structuredClone(state), result = releaseCandidate(state, [], { heldItemNumbers: held, expectedCount: 102 });
  assert.equal(result.products.length, 102); assert.equal(result.audit.length, 102);
  assert.deepEqual(result.manifest.heldItemNumbers, held); assert.equal(result.manifest.publicationAllowed, false);
  assert.ok(result.products.every(p => !held.includes(p.itemNumber) && p.status === 'AVAILABLE' && p.needsReview === false));
  assert.equal(result.handoff.products.length, 102); assert.ok(result.handoff.products.every(p => p.status === 'NEEDS_REVIEW'));
  assert.deepEqual(state, before);
});
test('an approved Item with missing price or another approval failure fails with its Item ID', () => {
  for (const change of [i => i.product.asking = null, i => i.product.description = 'English chair.', i => i.copyChecked = false, i => i.questions.push({ required: true, resolved: false })]) {
    const state = sample(); change(state.items.find(i => i.product.itemNumber === 520));
    assert.throws(() => releaseCandidate(state, [], { expectedCount: 102 }), /Item 520/);
  }
});
test('explicit selection rejects held, unknown, duplicate and zero Items without bypassing validation', () => {
  const state = sample();
  for (const itemNumbers of [[512], [999], [510, 510], []]) assert.throws(() => approvedSelection(state, { itemNumbers }));
  assert.throws(() => releaseCandidate(state, [], { expectedCount: 101 }), /102/);
  assert.throws(() => releaseCandidate(state, [], { itemNumbers: [512], heldItemNumbers: held }), /retenidos/);
  state.mode = 'fixture';
  for (const [n, item] of state.items.entries()) { const id = `fixture-v5-${n + 1}`; item.product.itemNumber = id; item.product.id = `volume5-${id}`; item.product.slug = `articulo-item-${id}`; }
  assert.throws(() => approvedHandoff(state), /ensayo/);
});
test('full audit stays strict, subset audit rejects additions, omissions and duplicated identities', () => {
  const state = sample(), result = releaseCandidate(state, []);
  assert.throws(() => auditRoundTrip(state, result.products, result.projection), /Cobertura/);
  for (const bad of [result.products.slice(1), [...result.products, finalizedProduct(state.items[2])], [result.products[0], ...result.products.slice(0, -1)]]) assert.throws(() => auditRoundTrip(state, bad, result.projection, { itemNumbers: result.manifest.itemNumbers }));
});
test('projection preserves exact public fields, unit pricing, selected cover order and mixed pickup terms', () => {
  const state = sample(), item = state.items.find(i => i.product.itemNumber === 597);
  item.product.quantityTotal = 5; item.product.title += ' (por unidad)'; item.product.description = 'Hay 5 unidades; se venden individualmente. El precio por unidad es el indicado.';
  const extra = { sourceId: 'extra', path: 'images/volume-5/v5-extra.webp', role: 'public', justification: '' };
  item.photos.push(extra); state.sources.push({ sourceId: 'extra', optimizedPath: extra.path }); item.coverSourceId = 'extra';
  const result = releaseCandidate(state, []), p = result.projection.find(p => p.itemNumber === 597);
  assert.equal(p.quantityTotal, 5); assert.equal(p.askingPricePYG, 10000); assert.equal(p.images[0], '/images/volume-5/v5-extra.webp');
  assert.deepEqual(p.tags, ['hogar', 'venta de mudanza', 'volumen 5']); assert.equal(p.description, item.product.description);
  assert.equal(p.notIncludedVisible, 'Objeto decorativo'); assert.equal(p.functionality, 'No aplica');
  const delayed = result.projection.find(p => p.itemNumber === 510), immediate = result.projection.find(p => p.itemNumber === 511);
  assert.equal(delayed.depositPercent, 25); assert.equal(delayed.finalPaymentWindowStart, '2026-12-01'); assert.equal(delayed.finalPaymentWindowEnd, '2026-12-08');
  assert.equal(delayed.pickupWindowStart, '2026-12-09'); assert.equal(delayed.pickupWindowEnd, '2026-12-12');
  assert.equal(immediate.depositPercent, 100); assert.equal(immediate.pickupWindowStart, null); assert.equal(immediate.finalPaymentWindowStart, null);
  for (const row of result.projection) for (const key of ['ownerNotes', 'pricing', 'pricingDecision', 'confirmedFields', 'sourceGroupId', 'questions']) assert.equal(Object.hasOwn(row, key), false);
});
test('adding the candidate changes no previous batch product and never labels Volume 5 as Volume 4', () => {
  const base = catalogBatchProducts([]), candidate = releaseCandidate(sample(), []), after = catalogBatchProducts(candidate.products);
  for (const old of base) assert.deepEqual(after.find(p => p.id === old.id), old);
  assert.equal(after.length, base.length + 102); assert.ok(after.filter(p => p.itemNumber >= 510).every(p => p.tags.includes('volumen 5') && !p.tags.includes('volumen 4')));
});

test('candidate activation patch applies with standard git, including Windows line endings', async () => {
  const original = await readFile(new URL('../../netlify/functions/_shared/volume2-public.mjs', import.meta.url), 'utf8');
  const source = original.replace(/^import \{ VOLUME5_ITEMS \}.*\r?\n/m, '').replace('additionalVolume5Items = VOLUME5_ITEMS', 'additionalVolume5Items = []');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'volume5-activation-'));
  await mkdir(path.join(dir, 'netlify/functions/_shared'), { recursive: true });
  await writeFile(path.join(dir, 'netlify/functions/_shared/volume2-public.mjs'), source);
  await writeFile(path.join(dir, 'activation.patch'), activationPatch(source));
  const run = promisify(execFile); await run('git', ['init', '--quiet'], { cwd: dir });
  await run('git', ['config', 'core.autocrlf', 'true'], { cwd: dir });
  await run('git', ['apply', '--check', 'activation.patch'], { cwd: dir });
  await run('git', ['apply', 'activation.patch'], { cwd: dir });
  const activated = await readFile(path.join(dir, 'netlify/functions/_shared/volume2-public.mjs'), 'utf8');
  assert.match(activated, /import \{ VOLUME5_ITEMS \}/); assert.equal(activationPatch(activated), '');
});
test('dry run is additive and repeatable; live sold/reserved records, inventory and settings survive', async () => {
  const old = [{ id: 'legacy-1', itemNumber: 1, slug: 'legacy-1', status: 'SOLD', quantityTotal: 2, quantitySold: 2, quantityRemaining: 0, askingPricePYG: 18000 }];
  const candidate = releaseCandidate(sample(), old), once = planAdditiveCatalog(old, candidate.projection);
  const sold = once.products.find(p => p.itemNumber === 510); sold.status = 'SOLD'; sold.quantityRemaining = 0;
  const again = planAdditiveCatalog(once.products, candidate.projection);
  assert.equal(again.added.length, 0); assert.deepEqual(again.products, once.products); assert.deepEqual(again.updated, []); assert.deepEqual(again.removed, []);
  const live = await loadCatalog('https://example.test', { loadBaseCatalog: async () => once.products, listProductOverrides: async () => [{ productId: 'legacy-1', publicFields: { status: 'RESERVED', askingPricePYG: 19000 } }], readCommittedInventory: async () => new Map() });
  assert.equal(live.find(p => p.id === 'legacy-1').status, 'RESERVED'); assert.equal(live.find(p => p.id === 'legacy-1').askingPricePYG, 19000);
  for (const key of ['id', 'itemNumber', 'slug']) assert.throws(() => planAdditiveCatalog(old, [{ ...candidate.projection[0], [key]: old[0][key] }]));
});
test('later release adds only 512/514/604 with the same IDs and preserves the original 102 verbatim', () => {
  const state = sample(), first = releaseCandidate(state, []);
  for (const item of active(state)) if (held.includes(item.product.itemNumber)) item.reviewStatus = 'approved';
  const second = releaseCandidate(state, first.projection, { expectedCount: 3, itemNumbers: held });
  assert.deepEqual(second.manifest.itemNumbers, held); assert.equal(second.audit.length, 3);
  const combined = appendVolume5Batch(first.products, second.products);
  assert.equal(combined.length, 105); for (const p of first.products) assert.deepEqual(combined.find(q => q.id === p.id), p);
  assert.throws(() => releaseCandidate(state, first.projection, { itemNumbers: [510] }), /publicados/);
  const hiddenPrevious = releaseCandidate(state, [], { publishedItemNumbers: first.manifest.itemNumbers, expectedCount: 3 });
  assert.deepEqual(hiddenPrevious.manifest.itemNumbers, held); // Archived/hidden existing IDs stay excluded too.
});
