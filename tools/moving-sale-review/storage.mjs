import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, copyFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { loadExistingProducts } from '../volume4-pilot/workflow.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { FIRST_ITEM, RETIRED, PUBLIC_FIELDS, assert, active, reconcile, publicErrors, pricingResearch, approvalErrors, applyTiming } from './core.mjs';
const exec = promisify(execFile);
export const hash = buffer => createHash('sha256').update(buffer).digest('hex');
export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
export async function atomicJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, file);
}
export async function saveState(dir, state, previous) {
  if (previous) {
    const backup = path.join(dir, 'backups', `volume5-revision-${previous.revision}-${Date.now()}.json`);
    await atomicJson(backup, previous);
  }
  await atomicJson(path.join(dir, 'owner-review-state.json'), state);
}
export async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'No se permiten enlaces en las fotos de entrada.');
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file)); else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}
export function historicalNumbers(text) {
  const numbers = new Set(RETIRED);
  for (const pattern of [/\bitemNumber["']?\s*:\s*(\d+)/g, /\bItem\s+(\d+)\b/gi, /real-\d+-volume\d+-(\d+)\b/g, /["'](\d+)["']\s*:\s*\{/g]) {
    for (const match of text.matchAll(pattern)) numbers.add(Number(match[1]));
  }
  return numbers;
}
export async function registry(root) {
  const [legacy, { VOLUME4_ITEMS }, history, common] = await Promise.all([
    loadExistingProducts(root), import(pathToFileURL(path.join(root, 'source/lib/volume4-batch.mjs')).href),
    exec('git', ['log', '--all', '--format=', '-p', '--', 'index.html', 'source/lib/*batch*', 'source/lib/sample-products.ts', 'source/lib/*supplemental*', 'volume*/**/*.json', 'volume*/production-handoff.json', 'tools/volume4-pilot/*.mjs'], { cwd: root, maxBuffer: 128 * 1024 * 1024 }),
    exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root }),
  ]);
  let volume5 = [];
  try {
    const file = path.join(root, 'source/lib/volume5-batch.mjs');
    await readFile(file);
    ({ VOLUME5_ITEMS: volume5 } = await import(pathToFileURL(file).href));
    assert(Array.isArray(volume5), 'Lote publicado de Volume 5 inválido.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const existing = [...legacy, ...VOLUME4_ITEMS, ...volume5];
  const used = historicalNumbers(history.stdout);
  for (const product of existing) used.add(Number(product.itemNumber));
  // All legacy slots are blocked, including historical gaps, never inferred reusable.
  for (let number = 1; number < FIRST_ITEM; number++) used.add(number);
  return { existing, used, ledgerPath: path.join(common.stdout.trim(), 'moving-sale-volume5-ids.json') };
}
export async function withLock(file, action) {
  const lock = `${file}.lock`;
  await mkdir(path.dirname(file), { recursive: true });
  await mkdir(lock).catch(() => { throw new Error(`Otro proceso usa ${file}. Si se interrumpió, revise el bloqueo antes de retirarlo.`); });
  try { return await action(); } finally { await import('node:fs/promises').then(fs => fs.rmdir(lock)); }
}
export async function allocate({ used, ledgerPath, count, batchId }) {
  return withLock(ledgerPath, async () => {
    let ledger;
    try { ledger = await readJson(ledgerPath); } catch (error) { if (error.code !== 'ENOENT') throw error; ledger = { volume: 5, allocations: [] }; }
    assert(ledger.volume === 5 && Array.isArray(ledger.allocations), 'Registro inmutable inválido.');
    assert(Number.isInteger(count) && count > 0, 'Cantidad de números inválida.');
    const assigned = ledger.allocations.flatMap(a => a.itemNumbers);
    const all = new Set([...used, ...assigned]);
    let next = Math.max(FIRST_ITEM - 1, ...all) + 1;
    if (!assigned.length) assert(next === FIRST_ITEM, 'El primer Item real debe ser 510; el catálogo o historial ya avanzó.');
    const numbers = Array.from({ length: count }, () => {
      while (all.has(next) || RETIRED.includes(next)) next++;
      const number = next++; all.add(number); return number;
    });
    ledger.allocations.push({ batchId, itemNumbers: numbers, at: new Date().toISOString() });
    // Reserve before any output is produced. Interrupted allocations remain consumed forever.
    await atomicJson(ledgerPath, ledger);
    return numbers;
  });
}
export async function verifyFiles(state, outputDir) {
  const summary = reconcile(state);
  const outputs = new Set();
  for (const source of state.sources) {
    const original = await readFile(source.originalPath).catch(() => { throw new Error(`Falta archivo original: ${source.filename}`); });
    assert(hash(original) === source.sha256, `El original cambió: ${source.filename}`);
    if (source.disposition === 'excluded') continue; // The original is still rehashed; no derivative exists.
    assert(path.resolve(outputDir, source.optimizedPath) !== path.resolve(source.originalPath), 'La copia no puede sobrescribir el original.');
    assert(!outputs.has(source.optimizedPath), 'Ruta optimizada duplicada.'); outputs.add(source.optimizedPath);
    const copy = await readFile(path.join(outputDir, source.optimizedPath)).catch(() => { throw new Error(`Falta archivo optimizado: ${source.optimizedPath}`); });
    assert(hash(copy) === source.optimizedSha256, `La copia optimizada cambió: ${source.filename}`);
  }
  return summary;
}
export async function validateState(state, { outputDir, used = new Set(), existing = [], allocated = [] }) {
  const summary = await verifyFiles(state, outputDir);
  const allowed = new Set(allocated);
  for (const item of state.items) {
    assert(Object.keys(item.product).every(key => PUBLIC_FIELDS.includes(key) || ['status', 'needsReview'].includes(key)), 'Hay campos internos o no reconocidos en el producto público.');
    assert(Object.hasOwn({ unreviewed: 1, missing: 1, approved: 1, 're-review': 1 }, item.reviewStatus), 'Estado de revisión inválido.');
    assert(item.product.status === 'NEEDS_REVIEW' && item.product.needsReview === true, 'Todos los borradores deben permanecer NEEDS_REVIEW.');
    if (state.mode === 'real') {
      assert(allowed.has(item.product.itemNumber), 'Item ausente del registro inmutable.');
      assert(!existing.some(p => p.itemNumber === item.product.itemNumber && p.id !== item.product.id), 'Número de Item usado por otro producto.');
      const ownPublished = existing.some(p => p.itemNumber === item.product.itemNumber && p.id === item.product.id && /^real-202610-volume5-\d+$/.test(p.id));
      assert(!used.has(item.product.itemNumber) || ownPublished, 'Item usado anteriormente en catálogo o historial.');
    }
    for (const key of ['id', 'slug']) assert(!existing.some(p => p[key] === item.product[key] && !(state.mode === 'real' && allowed.has(item.product.itemNumber) && p.itemNumber === item.product.itemNumber && p.id === item.product.id && /^real-202610-volume5-\d+$/.test(p.id))), `Identificador global duplicado: ${key}.`);
    assert(Array.isArray(item.product.includedAccessories) && item.product.includedAccessories.every(x => typeof x === 'string'), 'Incluidos inválidos.');
    const timing = structuredClone(item.product); applyTiming(timing);
    for (const key of ['pickupWindowStart', 'pickupWindowEnd', 'finalPaymentWindowStart', 'finalPaymentWindowEnd']) assert(item.product[key] === timing[key], 'Fechas de retiro o pago inválidas.');
    // MEDIR is allowed internally, but approval and handoff reject it.
    const errors = publicErrors({ ...item.product, measurements: item.product.measurements === 'MEDIR' ? '' : item.product.measurements });
    assert(!errors.length, `Item ${item.product.itemNumber}: ${errors.join(' ')}`);
    assert(JSON.stringify(pricingResearch(item.pricing)) === JSON.stringify(item.pricing), 'La investigación contiene recomendaciones sin evidencia suficiente.');
    assert(!item.coverSourceId || item.photos.some(p => p.sourceId === item.coverSourceId && p.role === 'public'), 'Foto principal inválida.');
    if (item.reviewStatus === 'approved') assert(!approvalErrors(item).length, 'Aprobación incompleta.');
  }
  return { ...summary, activeItems: active(state).length, retiredItems: state.items.filter(i => i.retired).length, publicProjection: 0, volume: 5, ok: true };
}
export async function stateContext(state, root) {
  const reg = await registry(root);
  if (state.mode === 'fixture') return { ...reg, allocated: [] };
  const ledger = await readJson(reg.ledgerPath);
  const allocated = ledger.allocations.filter(a => a.batchId === state.batchId).flatMap(a => a.itemNumbers);
  return { ...reg, allocated };
}
export async function safeOutput(root, intakeDir, outputDir) {
  const repo = await realpath(root), intake = await realpath(intakeDir), output = path.resolve(outputDir);
  const relative = path.relative(intake, output);
  assert(relative !== '' && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'La salida no puede estar dentro de los originales.');
  const forbidden = ['images', 'source', 'netlify', 'compiled', 'js', 'assets', '.git'].map(p => path.join(repo, p).toLowerCase());
  assert(!forbidden.some(p => output.toLowerCase() === p || output.toLowerCase().startsWith(`${p}${path.sep}`)), 'La salida debe ser privada y ajena a las rutas de producción.');
  assert(output !== repo && output !== intake, 'Directorio de salida inválido.');
}
export async function copyApp(outputDir) {
  const toolDir = path.dirname(fileURLToPath(import.meta.url));
  for (const file of ['review.html', 'app.mjs', 'core.mjs', 'review.css']) await copyFile(path.join(toolDir, file), path.join(outputDir, file));
}
