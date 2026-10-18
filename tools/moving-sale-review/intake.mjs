import path from 'node:path';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { optimizeGroups, parseGroupedNotes } from '../volume4-pilot/workflow.mjs';
import { applyTiming, pricingResearch, slugify, assert, EDIT_FIELDS } from './core.mjs';
import { hash, walk, registry, allocate, safeOutput, atomicJson, saveState, copyApp, validateState } from './storage.mjs';
export async function ingest({ root, intakeDir, notesPath, outputDir, fixture = false, workbook = true }) {
  root = path.resolve(root); intakeDir = path.resolve(intakeDir); outputDir = path.resolve(outputDir);
  await safeOutput(root, intakeDir, outputDir);
  const files = await walk(intakeDir);
  assert(files.length > 0 && files.every(f => /\.(?:jpe?g|png|webp|tiff?|avif|heic)$/i.test(f)), 'La entrada debe contener solo fotos compatibles; ponga las notas fuera de esa carpeta.');
  assert(files.every(f => path.dirname(f) === intakeDir), 'Use una carpeta plana de originales.');
  const names = files.map(f => path.basename(f));
  assert(new Set(names.map(f => f.toLowerCase())).size === names.length, 'Nombres de foto duplicados.');
  let groups, companion = null;
  if (notesPath) {
    const buffer = await readFile(notesPath); companion = { path: path.resolve(notesPath), sha256: hash(buffer) };
    if (/\.json$/i.test(notesPath)) groups = JSON.parse(buffer.toString('utf8')).groups;
    else groups = parseGroupedNotes(buffer.toString('utf8')).map(g => ({ groupId: g.groupId, photos: g.photos, product: { title: g.fields.name || '', category: g.fields.category || 'Otros', description: g.notes.join(' ') || g.fields.name || '', asking: g.fields.price || null, condition: g.fields.condition || '', knownDefects: g.fields.defects || '', functionality: g.fields.functionality || '', measurements: g.fields.dimensions || '', quantityTotal: Number(g.fields.quantity || 1), includedAccessories: g.fields.includes?.split(';').map(s => s.trim()).filter(Boolean) || [] } }));
  } else groups = names.map((name, index) => ({ groupId: String(index + 1).padStart(4, '0'), photos: [name], product: {} }));
  assert(Array.isArray(groups) && groups.length > 0, 'No hay grupos.');
  const normalized = groups.map((g, index) => ({ ...g, groupId: String(index + 1).padStart(4, '0'), photos: g.photos || [], referencePhotos: g.referencePhotos || [] }));
  const refs = normalized.flatMap(g => [...g.photos, ...g.referencePhotos]);
  assert(new Set(refs.map(n => n.toLowerCase())).size === refs.length, 'Foto asignada más de una vez.');
  assert(JSON.stringify([...refs].sort()) === JSON.stringify([...names].sort()), 'Fotos sin asignar o fuentes faltantes.');
  for (const g of normalized) {
    assert(Object.keys(g.product || {}).every(key => EDIT_FIELDS.includes(key)), 'Las notas de producto solo pueden contener campos públicos editables; conserve la investigación y notas internas por separado.');
    assert(g.photos.length, 'Cada grupo necesita una foto pública.');
    if (g.photos.length > 1) assert(g.groupingJustification?.trim(), 'Para agrupar varias fotos explique por qué muestran el mismo producto o juego.');
    for (const name of g.referencePhotos) assert(g.referenceJustifications?.[name]?.trim(), 'Cada foto de referencia necesita una justificación.');
  }
  // Exclusive output: rerunning intake cannot erase any prior owner state.
  await mkdir(outputDir, { recursive: false });
  const sources = await Promise.all(files.map(async file => ({ filename: path.basename(file), originalPath: file, sha256: hash(await readFile(file)) })));
  const batchId = `volume5-${fixture ? 'fixture' : 'real'}-${randomUUID()}`;
  const reg = fixture ? { existing: [], used: new Set(), ledgerPath: null } : await registry(root);
  const itemNumbers = fixture ? normalized.map((_, i) => `fixture-v5-${String(i + 1).padStart(4, '0')}`) : await allocate({ ...reg, count: normalized.length, batchId });
  const imageDir = path.join(outputDir, 'images/volume-5');
  // The proven Volume 4 optimizer receives every source, including explicit references.
  // Reference roles stay private in the state and never appear in finalized public photos.
  const optimized = await optimizeGroups(normalized.map(g => ({ groupId: g.groupId, photos: [...g.photos, ...g.referencePhotos] })), { intakeDir, outputDir: imageDir, publicPrefix: 'images/volume-5', filePrefix: 'v5' });
  for (const [index, row] of optimized.report.entries()) {
    const source = sources.find(s => s.filename === row.originalFilename);
    Object.assign(source, { sourceId: `v5-source-${String(index + 1).padStart(5, '0')}`, optimizedPath: row.publicPath, optimizedSha256: hash(await readFile(path.join(outputDir, row.publicPath))) });
  }
  const { pyg } = await import('./core.mjs');
  const items = normalized.map((g, index) => {
    const number = itemNumbers[index], facts = g.product || {}, title = facts.title || 'Producto por identificar';
    const product = { itemNumber: number, id: fixture ? `volume5-${number}` : `real-202610-volume5-${number}`, title, category: 'Otros', description: `${title}.`, asking: null, condition: '', knownDefects: '', functionality: '', measurements: '', quantityTotal: 1, saleMode: 'IMMEDIATE', saleStructure: 'undecided', includedAccessories: [], notIncludedVisible: '', requiresVehicle: false, requiresLoadingHelp: false, ...facts };
    assert(product.itemNumber === number && product.id === (fixture ? `volume5-${number}` : `real-202610-volume5-${number}`), 'Las notas no pueden asignar IDs.');
    product.asking = pyg(product.asking); product.slug = `${slugify(product.title)}-item-${number}`;
    product.status = 'NEEDS_REVIEW'; product.needsReview = true; applyTiming(product);
    const photos = [...g.photos, ...g.referencePhotos].map(name => { const s = sources.find(s => s.filename === name); return { sourceId: s.sourceId, path: s.optimizedPath, role: g.referencePhotos.includes(name) ? 'reference' : 'public', justification: g.referenceJustifications?.[name] || '' }; });
    return { product, initialProduct: structuredClone(product), photos, coverSourceId: null, reviewStatus: 'unreviewed', groupingConfirmed: false, groupingJustification: g.groupingJustification || '', copyChecked: false, confirmedFields: g.sellerConfirmed === true ? Object.keys(facts) : [], ownerNotes: '', pricingDecision: '', pricing: pricingResearch(g.pricing), questions: [{ id: 'grouping', text: 'Confirmar que las fotos corresponden al mismo producto físico o juego intencional.', required: true, resolved: false }, ...(g.questions || [])], edited: false, retired: false };
  });
  const state = { schemaVersion: 1, volume: 5, batchId, mode: fixture ? 'fixture' : 'real', revision: 0, sources, companion, items, retiredItemNumbers: [], events: [{ type: 'INTAKE', at: new Date().toISOString() }] };
  const validation = await validateState(state, { outputDir, ...reg, allocated: itemNumbers });
  await saveState(outputDir, state);
  await atomicJson(path.join(outputDir, 'initial-owner-review-state.json'), state);
  await atomicJson(path.join(outputDir, 'intake-reconciliation.json'), { ...validation, images: optimized.report, grouping: items.map(i => ({ itemNumber: i.product.itemNumber, confirmed: false, justification: i.groupingJustification })) });
  await copyApp(outputDir);
  if (companion) await copyFile(companion.path, path.join(outputDir, `companion-notes${path.extname(companion.path)}`));
  if (workbook) { const { generateWorkbook } = await import('./workbook.mjs'); await generateWorkbook(state, outputDir); }
  await writeFile(path.join(outputDir, 'SOLO-REVISION-LOCAL.txt'), 'Volume 5 — Solo revisión local. No importar ni publicar este directorio.\n', 'utf8');
  return { state, validation, outputDir };
}
