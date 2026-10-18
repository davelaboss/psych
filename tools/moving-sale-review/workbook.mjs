import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { active, publicPhotos, STATUS_LABELS } from './core.mjs';
// Optional document runtime, discovered by configuration rather than machine-specific paths.
async function artifactLibrary() {
  const modules = process.env.CODEX_WORKSPACE_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  try { const require = createRequire(path.join(modules, '_moving_sale_resolver.cjs')); return await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href); }
  catch (error) { throw new Error(`No se encontró el generador de planillas. Configure CODEX_WORKSPACE_NODE_MODULES con las dependencias de documentos. ${error.message}`); }
}
export async function generateWorkbook(state, outputDir, { preview = false } = {}) {
  const { Workbook, SpreadsheetFile } = await artifactLibrary();
  const wb = Workbook.create(), sheet = wb.worksheets.add('Revisión'), internal = wb.worksheets.add('Referencia interna');
  const headers = ['Item ID', 'Miniatura', 'Cantidad de fotos públicas', 'Nombre actual', 'Precio actual del vendedor (Gs.)', 'Estado de revisión', 'Revisión del propietario', 'Nuevo nombre / corrección', 'Nuevo precio (Gs.)', 'Incluido con la venta', 'NO incluido con la venta', 'Condición / defectos / funcionamiento: corrección', 'Medidas', 'Acción sobre fotos', 'Estructura de venta', 'Otras notas', 'Precio actual del sitio (Gs.)', 'Precio original pagado (Gs.)', 'Precio nuevo encontrado (Gs.)', 'Precio sugerido por el propietario (Gs.)', 'Comentario de precio', 'Funcionamiento: corrección'];
  const items = active(state);
  const rows = items.map(i => { const p = i.product; return [p.itemNumber, '', publicPhotos(i).length, p.title, p.asking, STATUS_LABELS[i.reviewStatus], '', '', '', p.includedAccessories.join('\n'), p.notIncludedVisible, '', p.measurements, '', ({ individual: 'Vender por unidad', set: 'Vender juntos', flexible: 'Por separado o juntos', undecided: 'Falta decidir' })[p.saleStructure], i.ownerNotes, null, i.pricing.originalPricePaid, i.pricing.currentRetailPrice, null, i.pricingDecision, '']; });
  const internalHeaders = ['Item ID', 'Rango local usado (Gs.)', 'Confianza', 'Precio sugerido (Gs.)', 'Referencia venta rápida (Gs.)', 'Mínimo privado (Gs.)', 'Notas de investigación', 'URLs de fuentes', 'Incertidumbres', 'Archivos / referencias de imágenes', 'Funcionamiento actual', 'Defectos actuales', 'Comparables documentados'];
  const internalRows = items.map(i => [i.product.itemNumber, i.pricing.localUsedMarketRange?.join('–') || '', ({ LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' })[i.pricing.confidence], i.pricing.suggestedAskingPrice, i.pricing.fastSalePrice, i.pricing.privateSellerFloor, i.pricing.rationale || 'Falta investigación de precio', i.pricing.sources.join('\n'), i.pricing.uncertainties, i.photos.map(p => `${state.sources.find(s => s.sourceId === p.sourceId).filename} → ${p.path}${p.role === 'reference' ? ' (solo referencia)' : ''}`).join('\n'), i.product.functionality, i.product.knownDefects, JSON.stringify(i.pricing.comparables)]);
  function fill(s, head, data, name) {
    s.showGridLines = false;
    s.getRange('A2').values = [[`Volume 5 — ${name}${state.mode === 'fixture' ? ' · ENSAYO SIN IDs REALES' : ''}`]];
    s.getRange('A2').format.font = { name: 'Arial', size: 14, bold: true };
    s.getRange('A3').values = [['Vacío = sin cambios. REMOVE = quitar explícitamente. La planilla no publica ni aplica correcciones automáticamente.']];
    const matrix = [head, ...data];
    s.getRangeByIndexes(3, 0, matrix.length, head.length).values = matrix;
    const all = s.getRangeByIndexes(3, 0, Math.max(matrix.length, 2), head.length);
    all.format.font = { name: 'Arial', size: 11 }; all.format.wrapText = true; all.format.verticalAlignment = 'top'; all.format.columnWidth = 26;
    const header = s.getRangeByIndexes(3, 0, 1, head.length);
    header.format.fill = '#493D33'; header.format.font.color = '#FFFFFF'; header.format.font.bold = true; header.format.rowHeight = 58;
    header.format.horizontalAlignment = 'center'; header.format.verticalAlignment = 'center';
    s.freezePanes.freezeRows(4); s.freezePanes.freezeColumns(1);
    const end = Math.max(5, 4 + data.length);
    s.tables.add(`A4:${String.fromCharCode(64 + head.length)}${end}`, true, name === 'Revisión' ? 'Volume5Revision' : 'Volume5Referencia');
    s.getRange(`A5:A${end}`).format.columnWidth = 17;
    return end;
  }
  const last = fill(sheet, headers, rows, 'Revisión'); fill(internal, internalHeaders, internalRows, 'Referencia interna');
  sheet.getRange(`B5:B${last}`).format.columnWidth = 20; sheet.getRange(`D5:D${last}`).format.columnWidth = 36;
  sheet.getRange(`A5:V${last}`).format.rowHeight = 110;
  for (const col of ['E', 'I', 'Q', 'R', 'S', 'T']) sheet.getRange(`${col}5:${col}${last}`).setNumberFormat('"Gs. "#,##0');
  for (const col of ['D', 'E', 'F']) internal.getRange(`${col}5:${col}${last}`).setNumberFormat('"Gs. "#,##0');
  for (const col of ['G', 'H', 'I', 'L', 'N', 'P', 'T', 'U', 'V']) sheet.getRange(`${col}5:${col}${last}`).format.fill = '#FFF8E5';
  const dropdowns = { G: ['Está bien así', 'Cambiar', 'Pregunta', 'Revisar después'], V: ['Funciona muy bien', 'Funciona bien', 'Funciona parcialmente', 'No funciona', 'Falta probar', 'No aplica'], N: ['Sin cambios', 'Nueva foto principal', 'Falta acercamiento', 'Falta otro ángulo', 'Recorte natural si corresponde', 'Aclarar objeto no incluido'], O: ['Vender por unidad', 'Vender juntos', 'Por separado o juntos', 'Falta decidir'] };
  for (const [col, values] of Object.entries(dropdowns)) sheet.getRange(`${col}5:${col}${last}`).dataValidation = { rule: { type: 'list', values } };
  sheet.getRange(`F5:F${last}`).conditionalFormats.add('notContainsText', { text: 'Aprobado', format: { fill: '#FFF0C7' } });
  sheet.getRange(`G5:G${last}`).conditionalFormats.add('containsText', { text: 'Pregunta', format: { fill: '#F5DDDF' } });
  internal.getRange(`G5:M${last}`).format.columnWidth = 40; internal.getRange(`A5:M${last}`).format.rowHeight = 110;
  function fitRows(s, data, wideColumns) {
    data.forEach((row, index) => {
      const lines = Math.max(1, ...row.map((value, col) => String(value ?? '').split('\n').reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / (wideColumns.has(col) ? 38 : 24))), 0)));
      s.getRangeByIndexes(index + 4, 0, 1, row.length).format.rowHeight = Math.min(409, Math.max(110, 14 * lines + 12));
    });
  }
  fitRows(sheet, rows, new Set([3])); fitRows(internal, internalRows, new Set([6, 7, 8, 9, 10, 11, 12]));
  for (const [index, item] of items.entries()) {
    const photo = publicPhotos(item).find(p => p.sourceId === item.coverSourceId) || publicPhotos(item)[0];
    if (!photo) continue;
    const image = await sharp(await readFile(path.join(outputDir, photo.path))).resize(140, 130, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    sheet.images.add({ dataUrl: `data:image/png;base64,${image.toString('base64')}`, anchor: { from: { row: index + 4, col: 1 }, extent: { widthPx: 140, heightPx: 130 } } });
  }
  wb.recalculate();
  const inspect = await wb.inspect({ kind: 'table', range: 'Revisión!A4:F6', include: 'values', tableMaxRows: 3, tableMaxCols: 6, maxChars: 3000 });
  await writeFile(path.join(outputDir, 'volume5-workbook-check.json'), JSON.stringify({ volume: 5, revision: state.revision, items: items.length, inspection: inspect.ndjson }, null, 2));
  if (preview) for (const [s, range] of [['Revisión', 'A4:F6'], ['Referencia interna', 'A4:F6']]) {
    const img = await wb.render({ sheetName: s, range, scale: 1.5, format: 'png' });
    await writeFile(path.join(outputDir, s === 'Revisión' ? 'volume5-review-preview.png' : 'volume5-internal-preview.png'), new Uint8Array(await img.arrayBuffer()));
  }
  const file = await SpreadsheetFile.exportXlsx(wb);
  await file.save(path.join(outputDir, 'Moving_Sale_Inventory_Volume_5.xlsx'));
  return { rows: items.length, worksheets: ['Revisión', 'Referencia interna'] };
}
