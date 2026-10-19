import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { pricingResearch } from './core.mjs';
import { generateWorkbook } from './workbook.mjs';

// Read the exported package, independently of the table API being tested.
function unzip(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'ZIP end-of-directory record missing');
  const entries = new Map(), count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const method = bytes.readUInt16LE(offset + 10), size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const local = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(start, start + size);
    assert.ok(method === 0 || method === 8, `Unsupported ZIP method ${method}`);
    entries.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function assertFilters(entries, last) {
  const xml = name => { assert.ok(entries.has(name), `${name} missing`); return entries.get(name).toString('utf8'); };
  for (const [index, range] of [[1, `A4:V${last}`], [2, `A4:M${last}`]]) {
    const table = xml(`xl/tables/table${index}.xml`);
    assert.match(table, new RegExp(`<(?:(?:\\w+):)?table\\b[^>]*\\bref="${range}"`));
    assert.match(table, new RegExp(`<(?:(?:\\w+):)?autoFilter\\b[^>]*\\bref="${range}"`), 'Exported table must expose filter controls over every data row');
    assert.doesNotMatch(table, /\bhiddenButton="(?:1|true)"|\bshowButton="(?:0|false)"/);
    const sheet = xml(`xl/worksheets/sheet${index}.xml`);
    assert.match(sheet, /<(?:\w+:)?tablePart\b/);
    assert.match(xml(`xl/worksheets/_rels/sheet${index}.xml.rels`), new RegExp(`Target="/?(?:xl/)?(?:\\.\\./)?tables/table${index}\\.xml"`));
  }
}

test('exported 105-row review workbook retains functional filter metadata, rows, images and controls after reopen', async t => {
  const modules = process.env.CODEX_WORKSPACE_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  const require = createRequire(path.join(modules, '_volume5_workbook_test.cjs'));
  let library;
  try { library = require.resolve('@oai/artifact-tool'); }
  catch { t.skip('Optional document runtime unavailable; configure CODEX_WORKSPACE_NODE_MODULES to run exported-workbook checks.'); return; }
  const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(library).href);
  const output = await mkdtemp(path.join(os.tmpdir(), 'volume5-workbook-filters-'));
  await mkdir(path.join(output, 'images/volume-5'), { recursive: true });
  const photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#884422' } }).webp().toBuffer();
  const items = [], sources = [];
  for (let index = 0; index < 105; index++) {
    const itemNumber = `fixture-v5-${String(index + 1).padStart(4, '0')}`;
    const sourceId = `source-${index}`, image = `images/volume-5/v5-test-${index}.webp`;
    await writeFile(path.join(output, image), photo);
    sources.push({ sourceId, filename: `photo-${index}.JPG`, optimizedPath: image });
    items.push({ product: { itemNumber, title: `Producto ${index + 1}`, asking: null, includedAccessories: [], notIncludedVisible: '', measurements: '', saleStructure: 'individual', functionality: '', knownDefects: '' },
      photos: [{ sourceId, path: image, role: 'public' }], coverSourceId: null, reviewStatus: 'unreviewed', ownerNotes: '', pricing: pricingResearch(), pricingDecision: '', retired: false });
  }
  const state = { mode: 'fixture', volume: 5, revision: 0, items, sources }, original = structuredClone(state);
  const statePath = path.join(output, 'owner-review-state.json'), stateBytes = Buffer.from(JSON.stringify(state, null, 2));
  await writeFile(statePath, stateBytes);
  await generateWorkbook(state, output);
  assert.deepEqual(state, original);
  assert.deepEqual(await readFile(statePath), stateBytes, 'Workbook generation must not modify owner state');
  const workbookPath = path.join(output, 'Moving_Sale_Inventory_Volume_5.xlsx');
  const entries = unzip(await readFile(workbookPath));
  assertFilters(entries, 109);
  const sheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.equal([...sheet.matchAll(/<(?:\w+:)?dataValidation\b/g)].length, 4);
  for (const column of ['G', 'V', 'N', 'O']) assert.match(sheet, new RegExp(`sqref="${column}5:${column}109"`));
  const pane = sheet.match(/<(?:\w+:)?pane\b[^>]*>/)?.[0];
  assert.match(pane, /xSplit="1"/); assert.match(pane, /ySplit="4"/); assert.match(pane, /state="frozen"/);
  assert.equal([...entries.keys()].filter(name => name.startsWith('xl/media/')).length, 105);
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
  const review = wb.worksheets.getItem('Revisión'), internal = wb.worksheets.getItem('Referencia interna');
  assert.deepEqual(review.getRange('A5:A109').values.flat(), items.map(i => i.product.itemNumber));
  assert.deepEqual(internal.getRange('A5:A109').values.flat(), items.map(i => i.product.itemNumber));
  assert.deepEqual(review.getRange('D5:D109').values.flat(), items.map(i => i.product.title));
  for (const s of [review, internal]) { assert.equal(s.tables.items.length, 1); assert.equal(s.tables.items[0].rowCount, 105); assert.equal(s.tables.items[0].showFilterButton, true); }
  const reopened = await SpreadsheetFile.exportXlsx(wb), reopenedPath = path.join(output, 'reopened.xlsx');
  await reopened.save(reopenedPath);
  assertFilters(unzip(await readFile(reopenedPath)), 109);
  assert.deepEqual(await readFile(statePath), stateBytes);
});
