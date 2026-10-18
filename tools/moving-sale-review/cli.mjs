import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ingest } from './intake.mjs';
import { serve } from './server.mjs';
import { readJson, atomicJson, stateContext, validateState, saveState, copyApp } from './storage.mjs';
import { auditRoundTrip, assert, reduceState } from './core.mjs';
const { positionals, values } = parseArgs({ allowPositionals: true, options: { repo: { type: 'string' }, photos: { type: 'string' }, notes: { type: 'string' }, output: { type: 'string' }, port: { type: 'string' }, fixture: { type: 'boolean' }, batch: { type: 'string' }, projection: { type: 'string' }, operations: { type: 'string' } } });
const root = path.resolve(values.repo || fileURLToPath(new URL('../../', import.meta.url)));
const outputDir = path.resolve(values.output || path.join(root, '.moving-sale-review/volume5'));
try {
  const command = positionals[0] || 'serve';
  if (command === 'ingest') {
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
      const audit = auditRoundTrip(state, await readJson(values.batch), await readJson(values.projection));
      await atomicJson(path.join(outputDir, 'volume5-round-trip-audit.json'), { volume: 5, batchId: state.batchId, revision: state.revision, generatedAt: new Date().toISOString(), publicationAllowed: false, audit });
      console.log('Todos los campos y fotos coinciden. Esta herramienta no publica.');
    }
  } else throw new Error('Comando desconocido. Use init, ingest, serve, validate, assist, workbook o audit.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
