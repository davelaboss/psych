// Preparation only: never changes owner state, production source, or live stores.
import path from 'node:path';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { active, approvedSelection, approvedHandoff, auditRoundTrip, assert, finalizedProduct } from './core.mjs';
import { readJson, stateContext, validateState, hash, withLock } from './storage.mjs';
import { loadBaseCatalog } from '../../netlify/functions/_shared/commerce.mjs';
import { catalogBatchProducts, publicProduct } from '../../netlify/functions/_shared/volume2-public.mjs';

export function planAdditiveCatalog(existing, candidates) {
  const result = structuredClone(existing), added = [], unchanged = [];
  const ids = new Map(existing.map(p => [p.id, p]));
  for (const p of candidates) {
    assert(p.id === `real-202610-volume5-${p.itemNumber}` && Number.isInteger(p.itemNumber) && p.itemNumber >= 510, 'Identidad de Volume 5 inválida.');
    const prior = ids.get(p.id);
    if (prior) {
      assert(prior.itemNumber === p.itemNumber && prior.slug === p.slug, `Colisión de identidad: ${p.id}.`);
      unchanged.push(p.itemNumber); continue; // Never reset live status/stock/overrides.
    }
    assert(!result.some(q => q.itemNumber === p.itemNumber || q.slug === p.slug), `Colisión global: Item ${p.itemNumber}.`);
    result.push(structuredClone(p)); ids.set(p.id, p); added.push(p.itemNumber);
  }
  return { products: result.sort((a, b) => Number(a.itemNumber) - Number(b.itemNumber)), added, unchanged, updated: [], removed: [] };
}

export function releaseCandidate(state, existing, { itemNumbers, heldItemNumbers = [], publishedItemNumbers = [], expectedCount, listingDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' }) } = {}) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(listingDate), 'Fecha de catálogo inválida.');
  const alreadyPublished = [...new Set([...publishedItemNumbers, ...existing.filter(p => /^real-202610-volume5-\d+$/.test(p.id)).map(p => p.itemNumber)])].sort((a,b) => a-b);
  if (itemNumbers) assert(itemNumbers.every(n => !alreadyPublished.includes(n) && !heldItemNumbers.includes(n)), 'La selección incluye Items ya publicados o retenidos.');
  const items = approvedSelection(state, { itemNumbers, excludeItemNumbers: [...alreadyPublished, ...heldItemNumbers] });
  if (expectedCount !== undefined) assert(items.length === expectedCount, `Cantidad inesperada: ${items.length}; se esperaban ${expectedCount}.`);
  const selected = items.map(i => i.product.itemNumber);
  const handoff = approvedHandoff(state, { itemNumbers: selected });
  const products = items.map(i => ({ ...finalizedProduct(i), status: 'AVAILABLE', needsReview: false, dateListed: listingDate }));
  const projection = products.map(publicProduct);
  const audit = auditRoundTrip(state, products, projection, { itemNumbers: selected });
  const dryRun = planAdditiveCatalog(existing, projection);
  assert(dryRun.added.length === products.length, 'La entrega debe contener solo productos nuevos.');
  const digest = createHash('sha256').update(JSON.stringify(products)).digest('hex');
  return { products, projection, audit, handoff, dryRun, manifest: { schemaVersion: 1, volume: 5, batchId: state.batchId, ownerRevision: state.revision, listingDate, publicationAllowed: false, deploymentStatus: 'PREPARED_NOT_DEPLOYED', releaseId: `volume5-${digest.slice(0, 16)}`, contentSha256: digest, itemNumbers: selected, heldItemNumbers: active(state).filter(i => i.reviewStatus !== 'approved' || heldItemNumbers.includes(i.product.itemNumber)).map(i => i.product.itemNumber), alreadyPublishedItemNumbers: alreadyPublished, count: products.length } };
}

export function appendVolume5Batch(previous, additions) {
  assert(new Set([...previous, ...additions].map(p => p.id)).size === previous.length + additions.length, 'El lote acumulado repite un ID.');
  return [...structuredClone(previous), ...structuredClone(additions)].sort((a, b) => a.itemNumber - b.itemNumber);
}

function activationPatch(source) {
  const before = 'export function catalogBatchProducts(additionalVolume5Items = []) {';
  if (source.includes('export function catalogBatchProducts(additionalVolume5Items = VOLUME5_ITEMS) {')) return '';
  assert(source.includes(before), 'Revise manualmente la integración actual del catálogo.');
  const line = source.slice(0, source.indexOf(before)).split('\n').length;
  return 'diff --git a/netlify/functions/_shared/volume2-public.mjs b/netlify/functions/_shared/volume2-public.mjs\n' +
    '--- a/netlify/functions/_shared/volume2-public.mjs\n+++ b/netlify/functions/_shared/volume2-public.mjs\n' +
    '@@ -1,3 +1,4 @@\n+import { VOLUME5_ITEMS } from \'../../../source/lib/volume5-batch.mjs\';\n import {\n   VOLUME2_BATCH_ITEMS,\n } from \'../../../source/lib/volume2-batch.ts\';\n' +
    `@@ -${line} +${line + 1} @@\n-` + before + '\n+export function catalogBatchProducts(additionalVolume5Items = VOLUME5_ITEMS) {\n';
}

export async function prepareRelease({ root, outputDir, releaseDir, ...options }) {
  root = path.resolve(root); outputDir = path.resolve(outputDir); releaseDir = path.resolve(releaseDir);
  const repoPath = await realpath(root), ownerPath = await realpath(outputDir);
  // A release is a separate private directory, never the repository/site or review state.
  for (const parent of [repoPath, ownerPath]) { const relative = path.relative(parent, releaseDir); assert(relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'La entrega debe estar fuera del sitio y de la revisión.'); }
  return withLock(path.join(outputDir, 'owner-review-state.json'), async () => {
    const stateBytes = await readFile(path.join(outputDir, 'owner-review-state.json')), state = JSON.parse(stateBytes);
    assert(state.publicationAllowed === false, 'La preparación no cambia autorización de publicación.');
    const context = await stateContext(state, root), ledgerBytes = await readFile(context.ledgerPath);
    const workbookPath = path.join(outputDir, 'Moving_Sale_Inventory_Volume_5.xlsx'), workbookHash = hash(await readFile(workbookPath));
    const validation = await validateState(state, { ...context, outputDir });
    const baseline = await loadBaseCatalog('', { catalogRoot: root });
    const previousVolume5 = context.existing.filter(p => /^real-202610-volume5-\d+$/.test(p.id));
    const candidate = releaseCandidate(state, baseline, { ...options, publishedItemNumbers: previousVolume5.map(p => p.itemNumber) });
    const currentBatch = catalogBatchProducts(), integrated = catalogBatchProducts(candidate.products);
    for (const p of currentBatch) assert(JSON.stringify(p) === JSON.stringify(integrated.find(q => q.id === p.id)), `Cambió un producto anterior: ${p.id}.`);
    const git = promisify(execFile);
    const [head, base] = await Promise.all([git('git', ['rev-parse', 'HEAD'], { cwd: root }), git('git', ['rev-parse', 'origin/main'], { cwd: root })]);
    const manifest = { ...candidate.manifest, baseCommit: base.stdout.trim(), toolingCommit: head.stdout.trim(), ownerStateSha256: hash(stateBytes), ledgerSha256: hash(ledgerBytes), workbookSha256: workbookHash, validation };
    let repeated = false;
    try { await mkdir(releaseDir); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await readJson(path.join(releaseDir, 'release-manifest.json'));
      assert(JSON.stringify(previous) === JSON.stringify(manifest), 'La carpeta ya contiene otra entrega; use una nueva carpeta.'); repeated = true;
    }
    const save = async (relative, content) => {
      const destination = path.join(releaseDir, relative);
      if (repeated) {
        const prior = await readFile(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (prior !== null) { assert(hash(prior) === hash(Buffer.from(content)), `Archivo de entrega alterado: ${relative}.`); return; }
      }
      await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, content, { flag: 'wx' });
    };
    await save('release-manifest.json', JSON.stringify(manifest, null, 2));
    await save('approved-review-handoff.json', JSON.stringify(candidate.handoff, null, 2));
    await save('production-candidate.json', JSON.stringify(candidate.products, null, 2));
    await save('public-projection.json', JSON.stringify(candidate.projection, null, 2));
    await save('round-trip-audit.json', JSON.stringify(candidate.audit, null, 2));
    await save('dry-run.json', JSON.stringify({ baseline: 'repository catalog; live operational stores are not read or written', existingCount: baseline.length, added: candidate.dryRun.added, updated: [], removed: [], existingUnchanged: baseline.length, resultingCount: candidate.dryRun.products.length }, null, 2));
    await save('candidate/source/lib/volume5-batch.mjs', '// Owner-approved candidate. Not active until separately authorized.\nexport const VOLUME5_ITEMS = Object.freeze(' + JSON.stringify(appendVolume5Batch(previousVolume5, candidate.products), null, 2) + ');\n');
    const adapter = await readFile(path.join(root, 'netlify/functions/_shared/volume2-public.mjs'), 'utf8');
    await save('activation.patch', activationPatch(adapter));
    const photos = [];
    for (const p of candidate.products) for (const photo of p.photos) {
      const relative = photo.slice(1), source = state.sources.find(s => s.optimizedPath === relative);
      assert(source && source.disposition !== 'excluded', 'Foto fuera de las fuentes autorizadas.');
      const bytes = await readFile(path.join(outputDir, relative)); assert(hash(bytes) === source.optimizedSha256, 'La foto cambió durante la preparación.');
      await save('candidate/' + relative, bytes); photos.push({ itemNumber: p.itemNumber, sourceId: source.sourceId, filename: source.filename, path: photo, sha256: hash(bytes) });
    }
    await save('photo-manifest.json', JSON.stringify(photos, null, 2));
    await save('PREPARATION-ONLY.txt', `Volume 5 ${manifest.releaseId}\n${manifest.count} approved Items. Held: ${manifest.heldItemNumbers.join(', ')}.\nNOT DEPLOYED. publicationAllowed=false.\nNo API writes, database migrations, overrides, orders, or settings changes.\nCandidate activation requires separate owner authorization.\nBefore activation: verify owner-state hash, current main, public projection and package hashes again.\nThe activation files add a Volume5 batch; they never replace earlier batches.\nDo not overwrite a later Volume5 batch when releasing held Items; append only newly approved IDs.\nRollback: if no Volume5 orders exist, revert only the activation commit/deploy. If orders exist, retain product identities and disable new sales only for these IDs through the existing owner controls; preserve orders, reservations, inventory rows, payments and overrides. Never restore an old database over newer activity.\n`);
    assert(hash(await readFile(path.join(outputDir, 'owner-review-state.json'))) === hash(stateBytes), 'La revisión cambió durante la exportación.');
    assert(hash(await readFile(context.ledgerPath)) === hash(ledgerBytes), 'El registro de IDs cambió.');
    assert(hash(await readFile(workbookPath)) === workbookHash, 'La planilla cambió.');
    return { ...manifest, photos: photos.length, existingProductsUnchanged: baseline.length, added: candidate.dryRun.added.length, updated: 0, removed: 0, repeated, releaseDir };
  });
}
