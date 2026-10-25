import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ingest } from './intake.mjs';
import { serve } from './server.mjs';
import { readJson, atomicJson, stateContext, validateState, saveState, copyApp } from './storage.mjs';
import { auditRoundTrip, assert, reduceState, approvedHandoff, approvedSelection } from './core.mjs';
import { prepareRelease } from './release.mjs';
const { positionals, values } = parseArgs({ allowPositionals: true, options: { repo: { type: 'string' }, photos: { type: 'string' }, notes: { type: 'string' }, output: { type: 'string' }, port: { type: 'string' }, fixture: { type: 'boolean' }, batch: { type: 'string' }, projection: { type: 'string' }, operations: { type: 'string' }, 'approved-only': { type: 'boolean' }, items: { type: 'string' }, held: { type: 'string' }, 'release-dir': { type: 'string' }, 'expected-count': { type: 'string' } } });
const root = path.resolve(values.repo || fileURLToPath(new URL('../../', import.meta.url)));
const outputDir = path.resolve(values.output || path.join(root, '.moving-sale-review/volume5'));
try {
  const numbers = value => { if (value === undefined) return undefined; assert(/^\d+(,\d+)*$/.test(value), 'Use números de Item separados por comas.'); return value.split(',').map(Number); };
  const command = positionals[0] || 'serve';
  if (command === 'release') {
    assert(values['release-dir'], 'Indique --release-dir fuera del sitio y de la revisión.');
    const expectedCount = values['expected-count'] === undefined ? undefined : Number(values['expected-count']);
    assert(expectedCount === undefined || (Number.isInteger(expectedCount) && expectedCount > 0), 'Cantidad esperada inválida.');
    console.log(JSON.stringify(await prepareRelease({ root, outputDir, releaseDir: values['release-dir'], itemNumbers: numbers(values.items), heldItemNumbers: numbers(values.held), expectedCount }), null, 2));
  } else if (command === 'handoff') {
    const state = await readJson(path.join(outputDir, 'owner-review-state.json'));
    await validateState(state, { ...await stateContext(state, root), outputDir });
    const handoff = approvedHandoff(state, { itemNumbers: numbers(values.items) });
    await atomicJson(path.join(outputDir, 'volume5-local-handoff.json'), handoff);
    console.log(JSON.stringify({ approved: handoff.products.length, held: handoff.heldItemNumbers, publicationAllowed: false }));
  } else if (command === 'ingest') {
    assert(values.photos, 'Indique --photos con la carpeta de originales.');
    const result = await ingest({ root, intakeDir: values.photos, notesPath: values.notes, outputDir, fixture: values.fixture });
    console.log(JSON.stringify({ outputDir, ...result.validation }, null, 2));
  } else if (command === 'serve' || command === 'init') {
    if (command === 'init') {
      await mkdir(outputDir, { recursive: false });
      await atomicJson(path.join(outputDir, 'owner-review-state.json'), { schemaVersion: 1, volume: 5, batchId: 'volume5-pending', mode: 'fixture', revision: 0, sources: [], items: [], retiredItemNumbers: [], events: [] });
      await copyApp(outputDir);
      console.log(`Volume 5 preparado en ${outputDir}. Todavía no se asignaron números de Item.`);
    } else {
      const server = await serve({ root, outputDir, port: Number(values.port || 5105) });
      console.log(`Volume 5 — revisión local: http://127.0.0.1:${server.address().port}/review.html\nDatos persistentes: ${outputDir}\nCierre esta terminal para detener el servidor; los datos quedan guardados.`);
    }
  } else if (command === 'validate' || command === 'audit' || command === 'assist' || command === 'workbook') {
    let state = await readJson(path.join(outputDir, 'owner-review-state.json'));
    const context = await stateContext(state, root);
    if (command === 'assist') {
      assert(values.operations, 'Indique --operations con las propuestas JSON.');
      const previous = state;
      for (const operation of await readJson(values.operations)) {
        assert(['assist', 'research'].includes(operation.type), 'Solo propuestas o investigación en este comando.');
        state = reduceState(state, operation);
      }
      await validateState(state, { ...context, outputDir });
      await saveState(outputDir, state, previous);
    }
    console.log(JSON.stringify(await validateState(state, { ...context, outputDir }), null, 2));
    if (command === 'workbook') { const { generateWorkbook } = await import('./workbook.mjs'); await generateWorkbook(state, outputDir); console.log('Planilla actualizada.'); }
    if (command === 'audit') {
      assert(values.batch && values.projection, 'Indique --batch y --projection del proceso futuro.');
      const itemNumbers = values.items ? numbers(values.items) : values['approved-only'] ? approvedSelection(state).map(i => i.product.itemNumber) : undefined;
      const audit = auditRoundTrip(state, await readJson(values.batch), await readJson(values.projection), { itemNumbers });
      await atomicJson(path.join(outputDir, 'volume5-round-trip-audit.json'), { volume: 5, batchId: state.batchId, revision: state.revision, generatedAt: new Date().toISOString(), publicationAllowed: false, audit });
      console.log('Todos los campos y fotos coinciden. Esta herramienta no publica.');
    }
  } else throw new Error('Comando desconocido. Use init, ingest, serve, validate, assist, workbook o audit.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
