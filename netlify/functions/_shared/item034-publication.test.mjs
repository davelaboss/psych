import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PHASE2_BATCH_ID, PHASE2_BATCH_NAME, PHASE2_BATCH_ITEMS } from '../../../source/lib/phase2-batch.ts';
import { VOLUME2_BATCH_ID, VOLUME2_BATCH_NAME, VOLUME2_BATCH_ITEMS } from '../../../source/lib/volume2-batch.ts';
import {
  SALE_READINESS_SUPPLEMENTAL_BATCH_ID, SALE_READINESS_SUPPLEMENTAL_BATCH_NAME,
  SALE_READINESS_SUPPLEMENTAL_ITEMS,
} from '../../../source/lib/sale-readiness-supplemental.ts';
import { VOLUME3_ITEMS } from '../../../source/lib/volume3-batch.mjs';
import { VOLUME4_ITEMS } from '../../../source/lib/volume4-batch.mjs';
import { VOLUME2_IMAGE_MAP } from '../../../source/lib/volume2-image-map.mjs';
import { jsonResponse, loadBaseCatalog, loadCatalog, loadPublicCatalog, projectPublicCatalog } from './commerce.mjs';
import { catalogBatchProducts } from './volume2-public.mjs';

const origin = 'https://example.test';
const id = 'real-20260828-34';
const source = PHASE2_BATCH_ITEMS.find(item => item.id === id);
const base = await loadBaseCatalog(origin);
const product = base.find(item => item.id === id);
const projectionSource = await readFile(new URL('./volume2-public.mjs', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');
const inventorySource = await readFile(new URL('../admin-legacy-inventory.mjs', import.meta.url), 'utf8');
const syncSource = await readFile(new URL('../admin-sync-product-source.mjs', import.meta.url), 'utf8');

// Run the actual existing handlers with in-memory reads/writes, never production services.
function moduleWithBindings(text, bindings, expression) {
  const body = text.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/gm, '')
    .replace(/export default async function handler/, 'async function handler')
    .replace(/export function /g, 'function ');
  return new Function(...Object.keys(bindings), `${body}\nreturn ${expression};`)(...Object.values(bindings));
}

// Independently rebuild membership before the Phase 2 admission using only the four prior batches.
const previousProjector = moduleWithBindings(projectionSource, { VOLUME2_IMAGE_MAP }, 'publicProduct');
const previousBatch = [
  ...VOLUME2_BATCH_ITEMS, ...SALE_READINESS_SUPPLEMENTAL_ITEMS, ...VOLUME3_ITEMS, ...VOLUME4_ITEMS,
].map(previousProjector).filter(item => item.status !== 'UNLISTED');
const html = await readFile(new URL('../../../index.html', import.meta.url), 'utf8');
const chunks = [...html.matchAll(/\.rsc\.push\(("(?:\\.|[^"\\])*")\)/g)].map(match => JSON.parse(match[1]));
const chunk = chunks.find(value => value.includes('"products":'));
const embedded = JSON.parse(chunk.slice(chunk.indexOf(':') + 1), (_key, value) =>
  typeof value === 'string' ? value.replace(/\n/g, '\\n') : value)[3].products;
const previousBase = [...new Map([...embedded, ...previousBatch].map(item => [item.id, item])).values()]
  .filter(item => item.status !== 'UNLISTED').sort((a, b) => a.itemNumber - b.itemNumber);

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function inputs(overrides = [], inventory = new Map(), products = base) {
  return {
    loadBaseCatalog: async () => structuredClone(products),
    listProductOverrides: async () => overrides,
    readCommittedInventory: async () => inventory,
  };
}

const sellerFields = Object.fromEntries([
  'title', 'category', 'description', 'condition', 'conditionNotes', 'knownDefects',
  'includedAccessories', 'askingPricePYG', 'saleMode', 'depositPercent', 'pickupAvailableDate',
  'pickupWindowStart', 'pickupWindowEnd', 'quantityTotal', 'requiresVehicle', 'requiresLoadingHelp',
].map(field => [field, product[field]]));
const images = ['main', 'open', 'inside', 'front', 'cover'].map(name =>
  `/.netlify/functions/product-photo?key=${id}%2Ffixture-${name}`);
const sellerOverride = freeze({
  productId: id, publicFields: structuredClone(sellerFields), images,
  internalFields: { internalNotes: 'Private seller note', adminPriceFloorPYG: 700000 },
  updatedAt: '2026-10-20T04:00:00.000Z',
});

function inventoryHandler(overrides = [sellerOverride], products = base) {
  return moduleWithBindings(inventorySource, {
    adminAuthorized: () => true, jsonResponse,
    PHASE2_BATCH_ID, PHASE2_BATCH_NAME, PHASE2_BATCH_ITEMS,
    VOLUME2_BATCH_ID, VOLUME2_BATCH_NAME, VOLUME2_BATCH_ITEMS,
    SALE_READINESS_SUPPLEMENTAL_BATCH_ID, SALE_READINESS_SUPPLEMENTAL_BATCH_NAME,
    SALE_READINESS_SUPPLEMENTAL_ITEMS,
    loadBaseCatalog: async () => products,
    loadCatalog: url => loadCatalog(url, inputs(overrides, new Map(), products)),
    listProductOverrides: async () => overrides,
  }, 'handler');
}

test('only Item 034 is added to both the base and public catalog, with immutable identity', () => {
  assert.equal(source.itemNumber, 34);
  assert.equal(product.id, id);
  assert.equal(product.itemNumber, 34);
  assert.equal(product.status, 'AVAILABLE');
  assert.equal(product.quantityRemaining, 1);
  assert.equal(base.length, previousBase.length + 1);
  assert.deepEqual(base.filter(item => item.id !== id), previousBase);
  assert.equal(catalogBatchProducts().length, previousBatch.length + 1);
  const before = projectPublicCatalog(previousBase, []).products;
  const after = projectPublicCatalog(base, []).products;
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.filter(item => !before.some(previous => previous.id === item.id)).map(item => item.id), [id]);
  for (const pending of PHASE2_BATCH_ITEMS.filter(item => !before.some(previous => previous.id === item.id))) {
    assert.equal(after.some(item => item.id === pending.id), pending.id === id, pending.id);
  }
});

test('seller-reviewed public source fields survive projection verbatim, including pickup dates and zero deposit', () => {
  assert.equal(product.title, 'Parrilla a carbón Fire King con ruedas y funda');
  assert.equal(product.askingPricePYG, 1200000);
  for (const field of ['title', 'category', 'description', 'condition', 'conditionNotes', 'knownDefects',
    'includedAccessories', 'saleMode', 'depositPercent', 'requiresVehicle', 'requiresLoadingHelp']) {
    assert.deepEqual(product[field], source[field], field);
  }
  assert.equal(product.askingPricePYG, source.asking);
  assert.equal(product.saleMode, 'IMMEDIATE');
  assert.equal(product.depositPercent, 0);
  assert.equal(product.pickupAvailableDate, source.pickupDate);
  assert.equal(product.pickupWindowStart, '2026-12-09');
  assert.equal(product.pickupWindowEnd, '2026-12-12');
  assert.match(product.description, /\n\u200bLa bandeja interior/);
  assert.deepEqual([source.marketLow, source.marketHigh, source.fast, source.floor, source.confidence],
    [750000, 1300000, 800000, 700000, 'Media']);
  assert.deepEqual(source.photos, ['IMG_7726.JPG', 'IMG_7727.JPG', 'IMG_7745.JPG']);
});

test('different runtime seller overrides supersede source title, price, description, condition and media', async () => {
  const override = freeze({ ...sellerOverride, publicFields: {
    title: 'Later seller title', askingPricePYG: 1234567,
    description: 'Later seller description\nSecond line.', condition: 'Later seller condition',
  }, images: [...images].reverse() });
  const before = structuredClone(override);
  const actual = (await loadCatalog(origin, inputs([override]))).find(item => item.id === id);
  assert.deepEqual(actual, { ...product, ...override.publicFields, images: override.images });
  assert.equal(actual.images[0], images.at(-1));
  assert.deepEqual(override, before);
  assert.equal(Object.hasOwn(actual, 'internalFields'), false);
});

test('repeated public reads preserve seller override, internal fields, media order and inventory', async () => {
  const before = structuredClone(sellerOverride);
  const inventory = new Map([[id, freeze({ capacity: 1, committed_quantity: 0 })]]);
  let overrideReads = 0, inventoryReads = 0;
  const dependencies = {
    loadCatalog: url => loadCatalog(url, {
      ...inputs([sellerOverride], inventory),
      listProductOverrides: async () => { overrideReads++; return [sellerOverride]; },
      readCommittedInventory: async () => { inventoryReads++; return inventory; },
    }),
    readFulfillmentDeliveryRows: async () => [],
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const actual = (await loadPublicCatalog(origin, {}, dependencies)).products.find(item => item.id === id);
    assert.deepEqual(actual.images, images);
    assert.equal(actual.images[0], images[0]);
    assert.equal(actual.quantityRemaining, 1);
    assert.equal(actual.quantitySold, 0);
    assert.equal(actual.status, 'AVAILABLE');
  }
  assert.deepEqual([overrideReads, inventoryReads], [2, 2]);
  assert.deepEqual(sellerOverride, before);
  assert.deepEqual([...inventory], [[id, { capacity: 1, committed_quantity: 0 }]]);
});

test('Admin marks Item 034 published while unrelated pending originals stay pending', async () => {
  const response = await inventoryHandler()(new Request(`${origin}/api/admin/legacy-inventory`));
  assert.equal(response.status, 200);
  const { products } = await response.json();
  const actual = products.find(item => item.id === id);
  assert.equal(actual.published, true);
  assert.equal(actual.live.id, id);
  assert.equal(actual.live.quantityRemaining, 1);
  assert.deepEqual(actual.images, images);
  assert.deepEqual(actual.sourceMismatchFields, ['images']);
  const previousIds = new Set(previousBase.map(item => item.id));
  for (const pending of PHASE2_BATCH_ITEMS.filter(item => item.id !== id && !previousIds.has(item.id))) {
    assert.equal(products.find(item => item.id === pending.id).published, false, pending.id);
  }
});

test('image-only source drift offers no source-sync button that could revert seller copy', async () => {
  const { products } = await (await inventoryHandler()(new Request(`${origin}/api/admin/legacy-inventory`))).json();
  const actual = products.find(item => item.id === id);
  const context = { Intl, window: { addEventListener() {} } };
  runInNewContext(`${adminSource}\n;globalThis.renderDetail = renderLegacyProductDetail;`, context);
  const detail = context.renderDetail(actual);
  assert.match(detail, /FOTO PRINCIPAL/);
  assert.doesNotMatch(detail, /data-sync-source/);
  assert.ok(detail.indexOf(images[0]) < detail.indexOf(images[1]));
});

test('local source-sync with reconciled Item 034 fields performs no write and preserves Admin media', async () => {
  let writes = 0;
  const handler = moduleWithBindings(syncSource, {
    adminAuthorized: () => true, jsonResponse,
    loadBaseCatalog: async () => base,
    loadCatalog: url => loadCatalog(url, inputs([sellerOverride])),
    getProductOverride: async () => { throw new Error('No override read needed'); },
    saveProductOverride: async () => { writes++; throw new Error('Unexpected write'); },
  }, 'handler');
  const response = await handler(new Request(`${origin}/local-only-source-sync`, {
    method: 'POST', body: JSON.stringify({ productId: id }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).changedFields, []);
  assert.equal(writes, 0);
  assert.deepEqual(sellerOverride.images, images);
});

test('existing original-item source-sync still reconciles public drift without touching private data or media', async () => {
  const original = base.find(item => item.itemNumber === 1);
  const stored = freeze({ ...sellerOverride, productId: original.id,
    publicFields: { title: 'Stale title', quantityRemaining: 0 } });
  let saved;
  const handler = moduleWithBindings(syncSource, {
    adminAuthorized: () => true, jsonResponse,
    loadBaseCatalog: async () => [original],
    loadCatalog: async () => [{ ...original, title: 'Stale title', quantityRemaining: 0 }],
    getProductOverride: async () => stored,
    saveProductOverride: async (productId, override) => { assert.equal(productId, original.id); saved = override; return override; },
  }, 'handler');
  const response = await handler(new Request(`${origin}/local-only-source-sync`, {
    method: 'POST', body: JSON.stringify({ productId: original.id }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).changedFields, ['title']);
  assert.deepEqual(saved, { ...stored, publicFields: { ...stored.publicFields, title: original.title } });
});

for (const status of ['UNLISTED', 'NEEDS_REVIEW']) {
  test(`Item 034 remains excluded when its resolved status is ${status}`, async () => {
    const resolved = await loadCatalog(origin, inputs([{ productId: id, publicFields: { status } }]));
    assert.equal(projectPublicCatalog(resolved, []).products.some(item => item.id === id), false);
  });
}

test('committed inventory still controls Item 034 availability without mutating the inventory row', async () => {
  const row = freeze({ capacity: 1, committed_quantity: 1 });
  const actual = (await loadCatalog(origin, inputs([sellerOverride], new Map([[id, row]])))).find(item => item.id === id);
  assert.equal(actual.status, 'SOLD');
  assert.equal(actual.quantityRemaining, 0);
  assert.equal(actual.quantitySold, 1);
  assert.deepEqual(row, { capacity: 1, committed_quantity: 1 });
});
