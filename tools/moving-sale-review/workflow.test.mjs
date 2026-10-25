import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, access, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { EDIT_FIELDS, active, applyTiming, approvalErrors, auditRoundTrip, finalizedProduct, identity, orderedPhotos, pricingResearch, publicErrors, publicPhotos, pyg, reconcile, reduceState, restoreState } from './core.mjs';
import { allocate, atomicJson, historicalNumbers, readJson, saveState, verifyFiles, validateState } from './storage.mjs';
import { ingest } from './intake.mjs';
import { serve } from './server.mjs';
import { optimizeGroups } from '../volume4-pilot/workflow.mjs';
import { catalogBatchProducts } from '../../netlify/functions/_shared/volume2-public.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const tmp = prefix => mkdtemp(path.join(os.tmpdir(), prefix));
function sample() {
  const sources = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ sourceId: id, filename: `${id}.jpg`, optimizedPath: `images/volume-5/v5-g0001-${i + 1}.webp` }));
  function item(number, ids) {
    const product = { itemNumber: number, id: `real-202610-volume5-${number}`, slug: `estante-item-${number}`, title: 'Estante', category: 'Muebles', asking: 100000, description: 'Estante de madera.', condition: 'Buen estado', knownDefects: 'Ninguno conocido.', functionality: 'No aplica', measurements: '80 × 45 × 40 cm', quantityTotal: 1, saleMode: 'IMMEDIATE', saleStructure: 'individual', includedAccessories: ['Soportes'], notIncludedVisible: 'Libros', requiresVehicle: false, requiresLoadingHelp: false, status: 'NEEDS_REVIEW', needsReview: true }; applyTiming(product);
    return { product, initialProduct: structuredClone(product), photos: ids.map(id => ({ sourceId: id, path: sources.find(s => s.sourceId === id).optimizedPath, role: 'public', justification: '' })), coverSourceId: ids[0], reviewStatus: 'approved', questions: [], groupingConfirmed: true, copyChecked: true, confirmedFields: [], pricing: pricingResearch(), ownerNotes: 'Nota confirmada', pricingDecision: 'Mantener precio', edited: false, retired: false };
  }
  return { schemaVersion: 1, volume: 5, mode: 'real', batchId: 'volume5-test', revision: 0, sources, items: [item(510, ['a', 'b', 'c', 'd']), item(511, ['e'])], retiredItemNumbers: [], events: [] };
}
function projections(state) {
  const batch = active(state).map(finalizedProduct);
  const projection = batch.map(p => { const { photos, asking, ...rest } = structuredClone(p); return { ...rest, images: photos, askingPricePYG: asking }; });
  return { batch, projection };
}
function operate(state, operation, options) { return reduceState(state, { itemNumber: 510, ...operation }, options); }

test('first real allocation is 510 and subsequent reservations never reuse numbers, including failed intake reservations', async () => {
  const dir = await tmp('volume5-id-'), ledgerPath = path.join(dir, 'ids.json');
  const context = { used: new Set([508, 509]), ledgerPath, batchId: 'volume5-test', count: 1 };
  assert.deepEqual(await allocate(context), [510]); assert.deepEqual(await allocate(context), [511]);
  const ledger = await readJson(ledgerPath); assert.equal(ledger.allocations.length, 2);
});
for (const number of [509, 342, 420, 437, 442, 444, 469, 507]) test(`used/retired Item ${number} rejected`, () => {
  const s = sample(); s.items[0].product.itemNumber = number; assert.throws(() => identity(s), /inválido|retirado/);
});
test('history scanner detects identifiers beyond retired allowlist and blocks allocation if history advanced', async () => {
  const used = historicalNumbers('"itemNumber": 612\nItem 613\nreal-202610-volume5-614\n"615": {');
  for (const id of [612, 613, 614, 615, 509]) assert.ok(used.has(id));
  await assert.rejects(allocate({ used, ledgerPath: path.join(await tmp('volume5-history-'), 'ids.json'), count: 1, batchId: 'volume5-test' }), /primer Item real/);
});
test('duplicate assignment and unassigned source rejected', () => {
  const s = sample(); s.items[0].photos.push(s.items[1].photos[0]); assert.throws(() => reconcile(s), /más de una vez/);
  const missing = sample(); missing.items[0].photos.pop(); assert.throws(() => reconcile(missing), /sin asignar|pérdida/);
});
test('duplicate output path and duplicate item/product/slug identifiers rejected', () => {
  const s = sample(); s.items[0].photos[1].path = s.items[0].photos[0].path; assert.throws(() => reconcile(s), /duplicada/);
  for (const key of ['itemNumber', 'id', 'slug']) { const s = sample(); s.items[1].product[key] = s.items[0].product[key]; assert.throws(() => reconcile(s)); }
});
test('cover at 0 stays; selected later cover moves first and remaining photos preserve relative order once', () => {
  const s = sample(), item = s.items[0]; assert.deepEqual(orderedPhotos(item).map(p => p.sourceId), ['a', 'b', 'c', 'd']);
  item.coverSourceId = 'c'; assert.deepEqual(orderedPhotos(item).map(p => p.sourceId), ['c', 'a', 'b', 'd']);
  assert.equal(new Set(finalizedProduct(item).photos).size, 4); assert.equal(finalizedProduct(item).coverIndex, 0);
});
test('reference photos require justification, stay available internally and cannot become cover', () => {
  const s = sample(); assert.throws(() => operate(s, { type: 'role', sourceId: 'c', role: 'reference' }), /Explique/);
  const changed = operate(s, { type: 'role', sourceId: 'c', role: 'reference', justification: 'Instrucción explícita del propietario: foto de manual.' });
  assert.equal(reconcile(changed).referenceOnlyPhotos, 1); assert.equal(finalizedProduct(changed.items[0]).photos.length, 3);
  assert.equal(changed.items[0].photos.length, 4); assert.throws(() => operate(changed, { type: 'cover', sourceId: 'c' }), /pública/);
});
test('removed or reference-only selected cover triggers re-review without replacement', () => {
  const s = sample(); const changed = operate(s, { type: 'role', sourceId: 'a', role: 'reference', justification: 'Instrucción del propietario.' });
  assert.equal(changed.items[0].coverSourceId, null); assert.equal(changed.items[0].reviewStatus, 're-review'); assert.throws(() => finalizedProduct(changed.items[0]), /principal/);
});
test('transfer moves cover away, preserves all sources and requires a new source cover', () => {
  const s = operate(sample(), { type: 'transfer', sourceIds: ['a'], targetItemNumber: 511 });
  assert.equal(s.items[0].coverSourceId, null); assert.equal(s.items[0].reviewStatus, 're-review');
  assert.equal(s.items[1].coverSourceId, 'e'); assert.equal(reconcile(s).inputPhotos, 5);
});
test('merge verifies photos before retirement and preserves target confirmed cover', () => {
  const original = sample(), s = operate(original, { type: 'merge', targetItemNumber: 511 });
  assert.equal(original.items[0].retired, false); assert.equal(s.items[0].retired, true); assert.equal(s.items[0].photos.length, 0);
  assert.deepEqual(s.items[1].photos.map(p => p.sourceId), ['e', 'a', 'b', 'c', 'd']); assert.equal(s.items[1].coverSourceId, 'e');
  assert.equal(s.events[0].type, 'TRANSFER_VERIFIED_BEFORE_RETIRE'); assert.deepEqual(s.retiredItemNumbers, [510]); assert.equal(reconcile(s).inputPhotos, 5);
});
test('split preserves photos exactly and requires both resulting covers', () => {
  const s = operate(sample(), { type: 'split', sourceIds: ['c', 'd'] }, { newItemNumber: 512 });
  assert.equal(reconcile(s).inputPhotos, 5); assert.equal(active(s).length, 3);
  assert.equal(s.items[0].coverSourceId, null); assert.equal(s.items[2].coverSourceId, null);
  assert.equal(s.items[0].reviewStatus, 're-review'); assert.equal(s.items[2].reviewStatus, 're-review');
  for (const i of [s.items[0], s.items[2]]) assert.ok(approvalErrors(i).some(e => e.includes('principal')));
});
test('invalid transfer, split, merge or reorder leaves source state intact', () => {
  for (const op of [{ type: 'merge', targetItemNumber: 510 }, { type: 'transfer', targetItemNumber: 511, sourceIds: ['absent'] }, { type: 'order', sourceIds: ['a', 'a'] }, { type: 'split', sourceIds: ['a', 'b', 'c', 'd'] }]) {
    const s = sample(), before = structuredClone(s); assert.throws(() => operate(s, op, { newItemNumber: 512 })); assert.deepEqual(s, before);
  }
});
test('blank corrections preserve confirmed values; explicit REMOVE required; owner wins over assisted proposals', () => {
  let s = operate(sample(), { type: 'edit', changes: { title: 'Estante confirmado', asking: 35, measurements: '90 cm', functionality: 'No aplica', includedAccessories: ['Tapa'], quantityTotal: 2, ownerNotes: 'Mantener esta nota' } });
  const expected = structuredClone(s.items[0]);
  s = operate(s, { type: 'edit', changes: { title: '', asking: null, measurements: '', functionality: '', includedAccessories: [], quantityTotal: '', ownerNotes: '' } });
  assert.deepEqual(s.items[0].product, expected.product); assert.equal(s.items[0].ownerNotes, expected.ownerNotes);
  s = operate(s, { type: 'assist', changes: { title: 'Propuesta anterior', asking: 50, measurements: '1 cm' } });
  assert.equal(s.items[0].product.title, 'Estante confirmado'); assert.equal(s.items[0].product.asking, 35000); assert.equal(s.items[0].product.measurements, '90 cm');
  s = operate(s, { type: 'edit', changes: { measurements: 'REMOVE', includedAccessories: 'REMOVE' } });
  assert.equal(s.items[0].product.measurements, ''); assert.deepEqual(s.items[0].product.includedAccessories, []);
});
test('approved materially edited Item becomes re-review and must repeat Spanish check', () => {
  const s = operate(sample(), { type: 'edit', changes: { title: 'Estante alto' } });
  assert.equal(s.items[0].reviewStatus, 're-review'); assert.equal(s.items[0].copyChecked, false);
});
test('reset preserves owner-confirmed fields, owner notes and photos', () => {
  let s = operate(sample(), { type: 'edit', changes: { title: 'Estante confirmado', ownerNotes: 'Dato del propietario' } });
  s = operate(s, { type: 'reset', confirm: 'RESTABLECER' });
  assert.equal(s.items[0].product.title, 'Estante confirmado'); assert.equal(s.items[0].ownerNotes, 'Dato del propietario'); assert.equal(s.items[0].photos.length, 4);
});
test('exported owner state restores all fields safely, with backup and deliberate reapproval', async () => {
  const old = sample(); const edited = operate(old, { type: 'edit', changes: { title: 'Estante alto', measurements: '90 cm', ownerNotes: 'Detalle privado' } });
  const restored = restoreState(old, JSON.parse(JSON.stringify(edited))); assert.equal(restored.items[0].product.title, 'Estante alto'); assert.equal(restored.items[0].coverSourceId, 'a'); assert.equal(restored.items[0].reviewStatus, 're-review'); assert.deepEqual(restored.items[0].pricing, edited.items[0].pricing);
  const dir = await tmp('volume5-state-'); await saveState(dir, old); await saveState(dir, restored, old);
  assert.equal((await readJson(path.join(dir, 'owner-review-state.json'))).revision, 1); assert.equal((await readdir(path.join(dir, 'backups'))).length, 1);
  for (const mutate of [s => s.batchId = 'volume5-other', s => s.sources.pop(), s => s.items.pop(), s => s.volume = 4]) { const invalid = sample(); mutate(invalid); assert.throws(() => restoreState(old, invalid)); }
});
test('PYG shorthand is accepted without ambiguity', () => {
  for (const [raw, value] of [[20, 20000], ['35', 35000], [450, 450000], ['Gs. 350.000', 350000], ['40000', 40000]]) assert.equal(pyg(raw), value);
  assert.equal(pyg(''), null); assert.throws(() => pyg('abc'));
});
const evidence = confidence => ({ confidence, rationale: 'Modelo y condición comparados con evidencia local.', sources: ['https://example.com.py/estante'], comparables: [{ itemSpecific: true, localParaguay: true, price: 200000, url: 'https://example.com.py/estante', observedAt: '2026-10-18', comparison: 'Mismo tamaño y material; nuevo frente a usado.', market: 'new' }], suggestedAskingPrice: 125000, fastSalePrice: 100000 });
test('category-only and LOW confidence never produce numeric suggested or fast-sale prices', () => {
  const generic = pricingResearch({ category: 'Cocina', suggestedAskingPrice: 50000 }); assert.equal(generic.suggestedAskingPrice, null);
  const low = pricingResearch(evidence('LOW')); assert.equal(low.suggestedAskingPrice, null); assert.equal(low.fastSalePrice, null);
});
for (const confidence of ['MEDIUM', 'HIGH']) test(`${confidence} item-specific local evidence may support numeric suggestions`, () => {
  const p = pricingResearch(evidence(confidence)); assert.equal(p.suggestedAskingPrice, 125000); assert.deepEqual(p.sources, evidence(confidence).sources);
});
test('pricing research cannot overwrite seller asking price and preserves distinct values', () => {
  const s = operate(sample(), { type: 'research', pricing: { ...evidence('HIGH'), originalPricePaid: 300000, currentRetailPrice: 200000 } });
  assert.equal(s.items[0].product.asking, 100000); assert.equal(s.items[0].pricing.suggestedAskingPrice, 125000); assert.equal(s.items[0].pricing.originalPricePaid, 300000); assert.equal(s.items[0].pricing.currentRetailPrice, 200000);
});
test('assisted drafts cannot set or overwrite seller asking price, even without a confirmation flag', () => {
  const s = sample(); const existing = operate(s, { type: 'assist', changes: { asking: 50 } }); assert.equal(existing.items[0].product.asking, 100000);
  s.items[0].product.asking = null; const empty = operate(s, { type: 'assist', changes: { asking: 50 } }); assert.equal(empty.items[0].product.asking, null);
});
test('market range requires actual used comparables and matching evidence extrema', () => {
  assert.throws(() => pricingResearch({ localUsedMarketRange: [40000, 60000] }), /comparables/);
  const p = evidence('MEDIUM'); p.comparables[0].market = 'used'; p.sources.push('https://example.com.py/otro'); p.comparables.push({ ...p.comparables[0], url: p.sources[1], price: 250000 }); p.localUsedMarketRange = [200000, 250000];
  assert.deepEqual(pricingResearch(p).localUsedMarketRange, [200000, 250000]); p.localUsedMarketRange = [40000, 60000]; assert.throws(() => pricingResearch(p), /coincidir/);
});
test('complete approved public fields, cover and photo order round-trip exactly', () => {
  const s = sample(); s.items[0].coverSourceId = 'c'; const { batch, projection } = projections(s);
  assert.equal(batch[0].photos[0], `/${s.items[0].photos[2].path}`); assert.equal(projection[0].images[0], batch[0].photos[0]);
  assert.ok(auditRoundTrip(s, batch, projection).every(row => row.match === 'YES'));
});
for (const field of ['measurements', 'functionality', 'includedAccessories', 'notIncludedVisible', 'title', 'category', 'description', 'asking', 'condition', 'knownDefects', 'quantityTotal', 'saleMode', 'saleStructure', 'requiresVehicle', 'requiresLoadingHelp']) test(`mismatch in ${field} blocks future publication audit`, () => {
  const s = sample(); const { batch, projection } = projections(s); batch[0][field] = 'Diferente'; assert.throws(() => auditRoundTrip(s, batch, projection), /no coincide/);
  const pair = projections(s); pair.projection[0][field === 'asking' ? 'askingPricePYG' : field] = 'Diferente'; assert.throws(() => auditRoundTrip(s, pair.batch, pair.projection), /no coincide/);
});
test('cover, photo order and photo count mismatch block audit', () => {
  for (const mutate of [p => p.images.reverse(), p => p.images.pop(), p => p.images.push(p.images[0])]) { const s = sample(), { batch, projection } = projections(s); mutate(projection[0]); assert.throws(() => auditRoundTrip(s, batch, projection), /fotos/); }
});
test('incomplete approval, required questions, internal copy and obvious English block approval/audit', () => {
  const s = sample(); s.items[0].questions.push({ id: 'measure', required: true, resolved: false }); assert.throws(() => operate(s, { type: 'status', status: 'approved' }), /preguntas/);
  for (const text of ['MEDIR', 'AI reviewer', 'Sold separately', 'good condition']) { const p = structuredClone(sample().items[0].product); p.description = `${text}.`; assert.ok(publicErrors(p).length); }
  const pending = sample(); pending.items[0].reviewStatus = 'unreviewed'; const pair = projections(pending); assert.throws(() => auditRoundTrip(pending, pair.batch, pair.projection), /aprobación/);
});
test('multi-unit style, included/excluded contradiction, quantity and sale modes validated', () => {
  const p = sample().items[0].product; p.quantityTotal = 2; assert.ok(publicErrors(p).length);
  p.title = 'Estante (por unidad)'; p.description = 'Hay 2 unidades disponibles; se venden por separado. Precio por unidad.'; assert.deepEqual(publicErrors(p), []);
  p.notIncludedVisible = 'Soportes'; assert.ok(publicErrors(p).some(e => /contradicen/.test(e)));
  p.quantityTotal = 0; p.saleMode = 'NOW'; assert.ok(publicErrors(p).some(e => /Cantidad/.test(e))); assert.ok(publicErrors(p).some(e => /retiro/.test(e)));
});
test('Volume 5 identity rejects old volume IDs, paths and metadata', () => {
  for (const mutate of [s => s.volume = 4, s => s.batchId = 'volume3-batch', s => s.items[0].product.id = 'real-202610-volume4-510', s => s.items[0].photos[0].path = 'images/volume-4/v4-1.webp']) { const s = sample(); mutate(s); assert.throws(() => identity(s)); }
});
test('DELAYED uses website payment and pickup dates exactly', () => {
  const s = operate(sample(), { type: 'edit', changes: { saleMode: 'DELAYED' } }); const p = s.items[0].product;
  assert.equal(p.finalPaymentWindowStart, '2026-12-01'); assert.equal(p.finalPaymentWindowEnd, '2026-12-08'); assert.equal(p.pickupWindowStart, '2026-12-09'); assert.equal(p.pickupWindowEnd, '2026-12-12');
});

test('private review/research fields cannot leak into finalized products; current public catalog contains no Volume 5', () => {
  const item = sample().items[0]; item.product.pricingResearch = { privateSellerFloor: 1 }; item.product.ownerNotes = 'Privado';
  const final = finalizedProduct(item); assert.equal(Object.hasOwn(final, 'pricingResearch'), false); assert.equal(Object.hasOwn(final, 'ownerNotes'), false);
  assert.ok(catalogBatchProducts().every(p => !/volume5-/.test(p.id)));
  assert.equal(final.status, 'NEEDS_REVIEW'); assert.equal(final.needsReview, true);
});

test('placeholder identity and unresolved defects cannot be approved', () => {
  const item = sample().items[0]; item.product.title = 'Producto por identificar'; item.product.knownDefects = '';
  assert.ok(approvalErrors(item).some(e => /identificar/.test(e))); assert.ok(approvalErrors(item).some(e => /defectos/.test(e)));
});

test('fixture intake optimizes without modifying originals, uses no real ID, reconciles, persists and serves independent owner edits', async t => {
  const dir = await tmp('volume5-integration-'), input = path.join(dir, 'originals'), outputDir = path.join(dir, 'review'); await mkdir(input);
  const originalPath = path.join(input, 'frente.jpg');
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#884422' } }).jpeg().withMetadata({ orientation: 6 }).toFile(originalPath);
  const original = await readFile(originalPath);
  const result = await ingest({ root, intakeDir: input, outputDir, fixture: true, workbook: false }); const state = result.state;
  assert.match(state.items[0].product.itemNumber, /^fixture-v5-/); assert.equal(state.items[0].product.asking, null); assert.equal(state.items[0].product.functionality, ''); assert.equal(state.items[0].product.knownDefects, '');
  assert.equal(state.items[0].product.status, 'NEEDS_REVIEW'); assert.equal(state.items[0].product.needsReview, true); assert.equal(result.validation.publicProjection, 0);
  assert.deepEqual(await readFile(originalPath), original); const metadata = await sharp(path.join(outputDir, state.sources[0].optimizedPath)).metadata(); assert.equal(metadata.width, 800); assert.equal(metadata.height, 1200); assert.equal(metadata.exif, undefined);
  assert.notEqual(path.join(outputDir, state.sources[0].optimizedPath), originalPath);
  await assert.rejects(() => ingest({ root, intakeDir: input, outputDir, fixture: true, workbook: false }), /EEXIST/);
  await assert.rejects(() => ingest({ root, intakeDir: input, outputDir: path.join(input, 'output'), fixture: true, workbook: false }), /originales/);
  const server = await serve({ root, outputDir, port: 0 }); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(`${origin}/api/state`)).json();
  const response = await fetch(`${origin}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-review-token': session.token }, body: JSON.stringify({ revision: 0, operation: { type: 'edit', itemNumber: state.items[0].product.itemNumber, changes: { title: 'Estante confirmado', asking: 35 } } }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).state.items[0].product.asking, 35000);
  assert.equal((await readJson(path.join(outputDir, 'owner-review-state.json'))).items[0].product.title, 'Estante confirmado');
  const exported = await (await fetch(`${origin}/api/export`)).json(); assert.equal(exported.revision, 1);
  assert.equal((await fetch(`${origin}/owner-review-state.json`)).status, 400);
  assert.equal((await fetch(`${origin}/api/publish`, { method: 'POST' })).status, 400);
  const unauthorized = await fetch(`${origin}/api/action`, { method: 'POST', body: '{}' }); assert.equal(unauthorized.status, 400);
  const stale = await fetch(`${origin}/api/action`, { method: 'POST', headers: { 'x-review-token': session.token }, body: JSON.stringify({ revision: 0, operation: { type: 'status', itemNumber: state.items[0].product.itemNumber, status: 'approved' } }) }); assert.equal(stale.status, 400);
  assert.throws(() => auditRoundTrip(exported, [], []), /ensayo/);
  const missing = structuredClone(state); missing.sources[0].originalPath = path.join(input, 'absent.jpg'); await assert.rejects(() => verifyFiles(missing, outputDir), /Falta archivo original/);
  const missingCopy = structuredClone(state); missingCopy.sources[0].optimizedPath = 'images/volume-5/v5-missing.webp'; missingCopy.items[0].photos[0].path = missingCopy.sources[0].optimizedPath; await assert.rejects(() => verifyFiles(missingCopy, outputDir), /Falta archivo optimizado/);
  // A separate source avoids Windows image-decoder file-handle caching in this tamper test.
  const tamperedPath = path.join(dir, 'tampered.jpg'); await writeFile(tamperedPath, 'modified');
  const tampered = structuredClone(state); tampered.sources[0].originalPath = tamperedPath;
  await assert.rejects(() => verifyFiles(tampered, outputDir), /original cambió/);
});

test('previously used global item and product identities rejected in disk validation', async () => {
  const dir = await tmp('volume5-global-'), input = path.join(dir, 'originals'), outputDir = path.join(dir, 'review'); await mkdir(input);
  await sharp({ create: { width: 20, height: 20, channels: 3, background: '#888' } }).jpeg().toFile(path.join(input, 'a.jpg'));
  const { state } = await ingest({ root, intakeDir: input, outputDir, fixture: true, workbook: false });
  state.mode = 'real'; state.items[0].product.itemNumber = 510; state.items[0].product.id = 'real-202610-volume5-510'; state.items[0].product.slug = 'producto-item-510';
  await assert.rejects(() => validateState(state, { outputDir, used: new Set([510]), allocated: [510] }), /usado anteriormente/);
  await assert.rejects(() => validateState(state, { outputDir, used: new Set(), allocated: [510], existing: [{ id: state.items[0].product.id }] }), /global duplicado/);
  const ownPublished = structuredClone(state.items[0].product);
  assert.equal((await validateState(state, { outputDir, used: new Set([510]), allocated: [510], existing: [ownPublished] })).ok, true);
  await assert.rejects(() => validateState(state, { outputDir, used: new Set([510]), allocated: [510], existing: [ownPublished, { id: 'foreign-product', itemNumber: 510 }] }), /otro producto/);
  await assert.rejects(() => validateState(state, { outputDir, used: new Set([510]), allocated: [], existing: [ownPublished] }), /registro inmutable/);
});

// Exercise the actual UI control and save functions, including their emitted edit
// request, without adding a browser/runtime dependency to the repository tests.
const appSource = await readFile(new URL('./app.mjs', import.meta.url), 'utf8');
function ownerForm(initial) {
  let state = structuredClone(initial);
  const controls = new Map(), requests = [];
  const context = vm.createContext({
    dirty: false, busy: false, dirtyFields: new Set(), formStartValues: new Map(), pendingQuestions: new Map(), pendingResearch: null, selectedId: 510,
    item: state.items[0],
    element(tag) {
      let value = '';
      return { name: '', children: [], get value() { return value; }, set value(next) { value = String(next); }, append(child) { this.children.push(child); if (child.name) controls.set(child.name, child); } };
    },
    $(id) { assert.equal(id, 'edit'); return { elements: { namedItem: key => controls.get(key) } }; },
    alert(message) { assert.fail(message); },
    async action(operation) { requests.push(structuredClone(operation)); state = reduceState(state, operation); context.dirty = false; return true; },
  });
  vm.runInContext(appSource.slice(appSource.indexOf('const fields = ['), appSource.indexOf('const labels =')), context);
  vm.runInContext(appSource.slice(appSource.indexOf('function control('), appSource.indexOf('async function leave(')), context);
  vm.runInContext('for (const [key, label, kind] of fields) control(key, label, kind, key in item.product ? item.product[key] : item[key]);', context);
  return { requests, state: () => state, change(key, value) { const control = controls.get(key); control.value = value; control.oninput(); }, save: () => vm.runInContext('save()', context) };
}
function unapproved() { const s = sample(); s.items[0].reviewStatus = 'unreviewed'; return s; }

test('UI price-only save submits/confirms only asking and leaves untouched AI fields unconfirmed', async () => {
  const s = unapproved(); s.items[0].product.asking = null;
  const form = ownerForm(s); form.change('asking', '50'); await form.save();
  assert.deepEqual(form.requests[0].changes, { asking: '50' });
  assert.deepEqual(form.state().items[0].confirmedFields, ['asking']);
  assert.equal(form.state().items[0].product.asking, 50000);
  const assisted = operate(form.state(), { type: 'assist', changes: { title: 'Nuevo nombre propuesto' } });
  assert.equal(assisted.items[0].product.title, 'Nuevo nombre propuesto');
});
test('UI title-only save never confirms unrelated prepopulated values', async () => {
  const form = ownerForm(unapproved()); form.change('title', 'Estante alto'); await form.save();
  assert.deepEqual(form.requests[0].changes, { title: 'Estante alto' });
  assert.deepEqual(form.state().items[0].confirmedFields, ['title']);
});
test('UI untouched blanks and blank corrections preserve values without confirming other fields', async () => {
  const s = unapproved(); s.items[0].ownerNotes = ''; s.items[0].product.functionality = '';
  const form = ownerForm(s); form.change('measurements', ''); form.change('asking', '50'); await form.save();
  assert.deepEqual(form.requests[0].changes, { asking: '50' });
  assert.equal(form.state().items[0].product.measurements, s.items[0].product.measurements);
  assert.equal(form.state().items[0].product.functionality, ''); assert.equal(form.state().items[0].ownerNotes, '');
  assert.deepEqual(form.state().items[0].confirmedFields, ['asking']);
});
test('UI explicit REMOVE is still submitted and removes only the selected field', async () => {
  const form = ownerForm(unapproved()); form.change('measurements', 'REMOVE'); await form.save();
  assert.deepEqual(form.requests[0].changes, { measurements: 'REMOVE' });
  assert.equal(form.state().items[0].product.measurements, ''); assert.deepEqual(form.state().items[0].confirmedFields, ['measurements']);
});
test('UI reverting a field to its rendered value sends no edit or confirmation', async () => {
  const form = ownerForm(unapproved()); form.change('title', 'Otro nombre'); form.change('title', 'Estante'); await form.save();
  assert.equal(form.requests.length, 0); assert.deepEqual(form.state().items[0].confirmedFields, []);
});
test('explicit valid approval confirms all public editable fields and blocks assist replacement', () => {
  const approved = operate(unapproved(), { type: 'status', status: 'approved' });
  assert.deepEqual(new Set(approved.items[0].confirmedFields), new Set(EDIT_FIELDS));
  const changes = Object.fromEntries(EDIT_FIELDS.map(key => [key, 'Propuesta de reemplazo']));
  const assisted = operate(approved, { type: 'assist', changes });
  assert.deepEqual(assisted.items[0].product, approved.items[0].product);
  assert.equal(assisted.items[0].reviewStatus, 'approved');
});
test('failed approval confirms nothing', () => {
  const s = unapproved(); s.items[0].copyChecked = false;
  assert.throws(() => operate(s, { type: 'status', status: 'approved' }), /redacción/);
  assert.deepEqual(s.items[0].confirmedFields, []);
});
test('owner may edit an approved value, triggering re-review while approved values stay protected', () => {
  const approved = operate(unapproved(), { type: 'status', status: 'approved' });
  const edited = operate(approved, { type: 'edit', changes: { title: 'Estante confirmado alto' } });
  assert.equal(edited.items[0].product.title, 'Estante confirmado alto'); assert.equal(edited.items[0].reviewStatus, 're-review');
  const assisted = operate(edited, { type: 'assist', changes: { title: 'Reemplazo', condition: 'Otra condición' } });
  assert.equal(assisted.items[0].product.title, 'Estante confirmado alto'); assert.equal(assisted.items[0].product.condition, approved.items[0].product.condition);
});
test('reset cannot destroy any approved public value or a later owner correction', () => {
  const s = unapproved(); s.items[0].initialProduct.title = 'Borrador inicial'; s.items[0].initialProduct.measurements = '20 cm'; s.items[0].initialProduct.includedAccessories = [];
  const approved = operate(s, { type: 'status', status: 'approved' });
  assert.deepEqual(operate(approved, { type: 'reset', confirm: 'RESTABLECER' }).items[0].product, approved.items[0].product);
  const edited = operate(approved, { type: 'edit', changes: { measurements: '100 cm' } });
  assert.deepEqual(operate(edited, { type: 'reset', confirm: 'RESTABLECER' }).items[0].product, edited.items[0].product);
});

const run = promisify(execFile);
async function isolatedIntake() {
  const repo = await tmp('volume5-grouping-repo-'), intakeDir = path.join(repo, 'originals'), outputDir = path.join(repo, 'review'), notesPath = path.join(repo, 'notes.json');
  await mkdir(path.join(repo, 'source/lib'), { recursive: true }); await mkdir(intakeDir);
  await writeFile(path.join(repo, 'package.json'), '{"type":"module"}');
  for (const [file, symbol, value] of [
    ['volume2-batch.ts', 'VOLUME2_BATCH_ITEMS', '[]'], ['sale-readiness-supplemental.ts', 'SALE_READINESS_SUPPLEMENTAL_ITEMS', '[]'],
    ['volume3-batch.mjs', 'VOLUME3_ITEMS', '[]'], ['volume4-batch.mjs', 'VOLUME4_ITEMS', '[]'], ['volume2-image-map.mjs', 'VOLUME2_IMAGE_MAP', '{}'],
  ]) await writeFile(path.join(repo, 'source/lib', file), `export const ${symbol} = ${value};\n`);
  await writeFile(path.join(repo, 'index.html'), JSON.stringify({ products: [] }).replaceAll('"', String.fromCharCode(92, 34)));
  await run('git', ['init', '--quiet', repo]);
  await run('git', ['-c', 'user.name=Volume5 Tests', '-c', 'user.email=volume5-test@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'Isolated allocation test'], { cwd: repo });
  const photo = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#884422' } }).jpeg().toBuffer();
  for (const name of ['frente.jpg', 'detalle.jpg']) await writeFile(path.join(intakeDir, name), photo);
  await writeFile(notesPath, JSON.stringify({ groups: [{ photos: ['frente.jpg', 'detalle.jpg'], groupingJustification: 'El propietario confirma dos vistas del mismo producto físico.', product: { title: 'Estante de prueba', description: 'Estante de prueba.' } }] }));
  return { root: repo, intakeDir, outputDir, notesPath, workbook: false, ledgerPath: path.join(repo, '.git/moving-sale-volume5-ids.json') };
}
test('ungrouped real intake fails before output/allocation, leaves ledger absent and Item 510 available for a grouped product', async () => {
  const options = await isolatedIntake();
  await assert.rejects(() => ingest({ ...options, notesPath: undefined }), /Antes de asignar números permanentes.*--notes/);
  await assert.rejects(() => access(options.outputDir), { code: 'ENOENT' });
  await assert.rejects(() => access(options.ledgerPath), { code: 'ENOENT' });
  const { state } = await ingest(options);
  assert.equal(state.items.length, 1); assert.equal(state.items[0].product.itemNumber, 510); assert.equal(state.items[0].photos.length, 2);
  const ledger = await readJson(options.ledgerPath); assert.equal(ledger.allocations.length, 1); assert.deepEqual(ledger.allocations[0].itemNumbers, [510]);
  assert.equal(state.items[0].product.status, 'NEEDS_REVIEW');
});
test('ungrouped real intake leaves an existing immutable ledger byte-for-byte unchanged', async () => {
  const options = await isolatedIntake();
  await atomicJson(options.ledgerPath, { volume: 5, allocations: [{ batchId: 'volume5-isolated-reservation', itemNumbers: [510] }] });
  const before = await readFile(options.ledgerPath), beforeStat = await stat(options.ledgerPath);
  await assert.rejects(() => ingest({ ...options, notesPath: undefined }), /agrupación/);
  assert.deepEqual(await readFile(options.ledgerPath), before); assert.equal((await stat(options.ledgerPath)).mtimeMs, beforeStat.mtimeMs);
  await assert.rejects(() => access(options.outputDir), { code: 'ENOENT' });
});
test('fixture intake without a manifest still uses fixture identifiers and never creates the real ledger', async () => {
  const options = await isolatedIntake();
  const { state } = await ingest({ ...options, fixture: true, notesPath: undefined });
  assert.equal(state.items.length, 2); assert.ok(state.items.every(i => /^fixture-v5-/.test(i.product.itemNumber)));
  await assert.rejects(() => access(options.ledgerPath), { code: 'ENOENT' });
});
for (const [name, groups] of [
  ['empty', []], ['unassigned photo', [{ photos: ['frente.jpg'] }]],
  ['multiple photos with no grouping justification', [{ photos: ['frente.jpg', 'detalle.jpg'] }]],
  ['duplicate photo assignment', [{ photos: ['frente.jpg'] }, { photos: ['frente.jpg', 'detalle.jpg'], groupingJustification: 'Mismo producto.' }]],
]) test(`incomplete grouping manifest (${name}) cannot consume IDs`, async () => {
  const options = await isolatedIntake(); await writeFile(options.notesPath, JSON.stringify({ groups }));
  await assert.rejects(() => ingest(options));
  await assert.rejects(() => access(options.ledgerPath), { code: 'ENOENT' }); await assert.rejects(() => access(options.outputDir), { code: 'ENOENT' });
});

async function exclusionCase() {
  const options = await isolatedIntake();
  await writeFile(path.join(options.intakeDir, 'excluded.jpg'), await readFile(path.join(options.intakeDir, 'frente.jpg')));
  const manifest = { groups: [{ photos: ['frente.jpg'], referencePhotos: ['detalle.jpg'], referenceJustifications: { 'detalle.jpg': 'Foto redundante conservada solo como referencia.' }, groupingJustification: 'Un artículo con vista de referencia.', sellerConfirmed: true, groupingConfirmed: true, product: { title: 'Artículo de prueba', description: 'Artículo de prueba.', measurements: '24 cm', functionality: 'Funciona bien' } }], excludedPhotos: [{ filename: 'excluded.jpg', reason: 'Pertenece a un artículo ya publicado.' }] };
  await writeFile(options.notesPath, JSON.stringify(manifest));
  return { options, manifest };
}
test('documented excluded original is audited without an Item, photo, derivative or real allocation', async () => {
  const { options } = await exclusionCase();
  const { state, validation } = await ingest({ ...options, fixture: true });
  assert.equal(state.items.length, 1);assert.equal(state.items[0].photos.length, 2);
  assert.deepEqual([validation.inputPhotos, validation.publicCandidatePhotos, validation.referenceOnlyPhotos, validation.excludedPhotos, validation.unassignedPhotos], [3,1,1,1,0]);
  const excluded=state.sources.find(s=>s.disposition==='excluded');
  assert.equal(excluded.filename,'excluded.jpg');assert.ok(excluded.originalPath&&excluded.sha256&&excluded.exclusionReason);
  assert.equal(excluded.optimizedPath,undefined);assert.equal((await readdir(path.join(options.outputDir,'images/volume-5'))).length,2);
  assert.ok(state.items.every(i=>i.photos.every(p=>p.sourceId!==excluded.sourceId)));
  assert.throws(()=>reduceState(state,{type:'cover',itemNumber:state.items[0].product.itemNumber,sourceId:excluded.sourceId}),/pública/);
  const selected=reduceState(state,{type:'cover',itemNumber:state.items[0].product.itemNumber,sourceId:state.items[0].photos[0].sourceId});
  assert.equal(finalizedProduct(selected.items[0]).photos.length,1);
  assert.equal(state.items[0].groupingConfirmed,true);assert.equal(state.items[0].questions.length,0);
  assert.equal(state.items[0].product.measurements,'24 cm');assert.equal(state.items[0].product.functionality,'Funciona bien');
  assert.deepEqual(new Set(state.items[0].confirmedFields),new Set(['title','description','measurements','functionality']));
  assert.equal(state.items[0].reviewStatus,'unreviewed');assert.equal(state.publicationAllowed,false);
  assert.equal(state.items[0].pricing.suggestedAskingPrice,null);
  await assert.rejects(()=>access(options.ledgerPath),{code:'ENOENT'});
});
test('excluded originals are still rehashed and cannot be smuggled into photos or cover',async()=>{
  const {options}=await exclusionCase();const {state}=await ingest({...options,fixture:true});
  const excluded=state.sources.find(s=>s.disposition==='excluded');
  for(const role of ['public','reference']) {const bad=structuredClone(state);bad.items[0].photos.push({sourceId:excluded.sourceId,path:'images/volume-5/v5-invalid.webp',role,justification:'No permitido.'});assert.throws(()=>reconcile(bad),/excluida/);}
  const bad=structuredClone(state);bad.items[0].coverSourceId=excluded.sourceId;assert.throws(()=>reconcile(bad),/excluida/);
  await writeFile(excluded.originalPath,'changed');await assert.rejects(()=>verifyFiles(state,options.outputDir),/original cambió/);
});
for(const [name,change] of [
 ['blank exclusion reason',m=>{m.excludedPhotos[0].reason=' ';}],
 ['undeclared unassigned original',m=>{delete m.excludedPhotos;}],
 ['assigned and excluded',m=>{m.excludedPhotos.push({filename:'frente.jpg',reason:'No válido.'});}],
 ['duplicate exclusion',m=>{m.excludedPhotos.push({...m.excludedPhotos[0],filename:'EXCLUDED.JPG'});}],
 ['missing excluded original',m=>{m.excludedPhotos[0].filename='missing.jpg';}],
 ['invalid rotation',m=>{m.photoTransforms={'frente.jpg':{rotateDegrees:45}};}],
 ['string rotation',m=>{m.photoTransforms={'frente.jpg':{rotateDegrees:'-90'}};}],
 ['unknown transform',m=>{m.photoTransforms={'frente.jpg':{rotateDegrees:-90,crop:true}};}],
 ['nonexistent transform original',m=>{m.photoTransforms={'missing.jpg':{rotateDegrees:-90}};}],
 ['excluded transform original',m=>{m.photoTransforms={'excluded.jpg':{rotateDegrees:-90}};}],
 ['case-duplicate transform',m=>{m.photoTransforms={'frente.jpg':{rotateDegrees:-90},'FRENTE.JPG':{rotateDegrees:90}};}],
])test(`compatibility preflight rejects ${name} before output or permanent allocation`,async()=>{
  const {options,manifest}=await exclusionCase();change(manifest);await writeFile(options.notesPath,JSON.stringify(manifest));
  await assert.rejects(()=>ingest(options));await assert.rejects(()=>access(options.ledgerPath),{code:'ENOENT'});await assert.rejects(()=>access(options.outputDir),{code:'ENOENT'});
});
test('unreadable assigned image fails before output or permanent allocation',async()=>{
  const {options}=await exclusionCase();await writeFile(path.join(options.intakeDir,'frente.jpg'),'not an image');
  await assert.rejects(()=>ingest(options));await assert.rejects(()=>access(options.ledgerPath),{code:'ENOENT'});await assert.rejects(()=>access(options.outputDir),{code:'ENOENT'});
});
test('existing destination fails before real allocation and preserves its contents',async()=>{
  const {options}=await exclusionCase();await mkdir(options.outputDir);await writeFile(path.join(options.outputDir,'keep.txt'),'keep');
  await assert.rejects(()=>ingest(options),/salida ya existe/);assert.equal(await readFile(path.join(options.outputDir,'keep.txt'),'utf8'),'keep');await assert.rejects(()=>access(options.ledgerPath),{code:'ENOENT'});
});
async function asymmetric(input,orientation=1) {
 const w=80,h=40,data=Buffer.alloc(w*h*3),colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=colors[(y>=h/2?2:0)+(x>=w/2?1:0)];for(let k=0;k<3;k++)data[(y*w+x)*3+k]=c[k];}
 await sharp(data,{raw:{width:w,height:h,channels:3}}).jpeg({quality:100}).withMetadata({orientation}).toFile(input);
}
async function quadrants(file) {
 const {data,info}=await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
 return [[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>{const p=(Math.floor(y*info.height)*info.width+Math.floor(x*info.width))*info.channels;const distances=colors.map(c=>c.reduce((sum,v,k)=>sum+(data[p+k]-v)**2,0));return distances.indexOf(Math.min(...distances));});
}
for(const [name,orientation,degrees,expected] of [
 ['old caller default',1,undefined,[0,1,2,3]],['counterclockwise',1,-90,[1,3,0,2]],['clockwise',1,90,[2,0,3,1]],['EXIF clockwise then owner counterclockwise',6,-90,[0,1,2,3]],['EXIF alone',6,undefined,[2,0,3,1]],
])test(`optimizer proves pixel direction: ${name}`,async()=>{
 const dir=await tmp('volume5-rotation-'),input=path.join(dir,'originals'),outputDir=path.join(dir,'images');await mkdir(input);await asymmetric(path.join(input,'a.jpg'),orientation);
 const before=await readFile(path.join(input,'a.jpg'));
 const result=await optimizeGroups([{groupId:'0001',photos:['a.jpg']}],{intakeDir:input,outputDir,...(degrees===undefined?{}:{photoTransforms:{'a.jpg':{rotateDegrees:degrees}}})});
 const file=path.join(outputDir,result.report[0].optimizedFilename);
 assert.deepEqual(await quadrants(file),expected);assert.deepEqual(await readFile(path.join(input,'a.jpg')),before);
 const metadata=await sharp(file).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);
 assert.equal(result.report[0].manualRotationDegrees,degrees||0);
});
test('intake forwards owner transform through EXIF normalization and records provenance',async()=>{
 const {options,manifest}=await exclusionCase();await asymmetric(path.join(options.intakeDir,'frente.jpg'),6);
 manifest.photoTransforms={'frente.jpg':{rotateDegrees:-90}};await writeFile(options.notesPath,JSON.stringify(manifest));
 const {state}=await ingest({...options,fixture:true});const source=state.sources.find(s=>s.filename==='frente.jpg');
 assert.equal(source.manualRotationDegrees,-90);assert.deepEqual(await quadrants(path.join(options.outputDir,source.optimizedPath)),[0,1,2,3]);
 assert.equal((await readJson(path.join(options.outputDir,'intake-reconciliation.json'))).images.find(r=>r.originalFilename==='frente.jpg').manualRotationDegrees,-90);
 await assert.rejects(()=>access(options.ledgerPath),{code:'ENOENT'});
});
