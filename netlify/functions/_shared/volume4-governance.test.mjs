import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { VOLUME2_BATCH_ITEMS } from '../../../source/lib/volume2-batch.ts';
import { VOLUME4_ITEMS } from '../../../source/lib/volume4-batch.mjs';
import { projectPublicCatalog } from './commerce.mjs';
import { catalogBatchProducts } from './volume2-public.mjs';

const volume4PublicProducts = () => catalogBatchProducts()
  .filter(product => product.itemNumber >= 327);
const retiredIds = [342, 420, 437, 442, 444, 469, 507, 509];
const bundleSellableUnits = new Map([
  [354, { price: 6_000, pieceCopy: /Dos separadores/ }],
  [377, { price: 50_000, pieceCopy: /Dos fundas/ }],
  [485, { price: 25_000, pieceCopy: /Dos platos/ }],
  [486, { price: 80_000, pieceCopy: /cinco platos/ }],
  [487, { price: 12_000, pieceCopy: /seis cuchillos/ }],
  [488, { price: 8_000, pieceCopy: /cuatro cucharas/ }],
  [489, { price: 8_000, pieceCopy: /cuatro tenedores/ }],
  [492, { price: 35_000, pieceCopy: /Dos bols/ }],
  [495, { price: 78_000, pieceCopy: /tres platos Corelle medianos y tres platos Corelle pequeños/ }],
]);
const separateSellableUnits = new Map([
  [336, 3],
  [355, 2],
  [362, 2],
  [381, 2],
  [385, 2],
  [400, 2],
  [466, 3],
  [508, 2],
]);

test('Volume 4 preserves approved measurements and functionality in catalog projection', () => {
  assert.equal(VOLUME4_ITEMS.length, 175);
  assert.equal(VOLUME4_ITEMS.filter(item => item.measurements).length, 52);
  assert.equal(VOLUME4_ITEMS.filter(item => item.functionality).length, 174);

  const item333 = VOLUME4_ITEMS.find(item => item.itemNumber === 333);
  const item356 = VOLUME4_ITEMS.find(item => item.itemNumber === 356);
  const item389 = VOLUME4_ITEMS.find(item => item.itemNumber === 389);
  assert.equal(item333.measurements, '19 cm de alto');
  assert.equal(item356.measurements, '36 × 36 cm');
  assert.equal(item389.functionality, 'Funciona bien');

  const projected333 = volume4PublicProducts().find(item => item.itemNumber === 333);
  const projected389 = volume4PublicProducts().find(item => item.itemNumber === 389);
  assert.match(projected333.description, /Medidas: 19 cm de alto/);
  assert.match(projected389.description, /Funcionamiento: Funciona bien/);
});

test('Volume tags separate Volume 3 and Volume 4 at Item 327', () => {
  const products = catalogBatchProducts();
  assert.ok(products.filter(item => item.itemNumber >= 169 && item.itemNumber <= 326)
    .every(item => item.tags.includes('volumen 3') && !item.tags.includes('volumen 4')));
  assert.ok(products.filter(item => item.itemNumber >= 327)
    .every(item => item.tags.includes('volumen 4') && !item.tags.includes('volumen 3')));
});

test('Volume 4 publication requires complete owner approval and preserves the approved facts', async () => {
  const ownerState = JSON.parse(await readFile(
    new URL('../../../volume4/review-output/final-owner-review-state.json', import.meta.url),
    'utf8'
  ));
  assert.equal(Object.keys(ownerState.edits).length, 175);
  assert.equal(Object.values(ownerState.statuses).filter(status => status === 'approved').length, 175);
  for (const product of VOLUME4_ITEMS) {
    const edit = ownerState.edits[product.itemNumber];
    assert.equal(product.title, edit.title);
    assert.equal(product.category, edit.category);
    assert.equal(product.asking, edit.price);
    assert.equal(product.description, edit.description);
    assert.equal(product.condition, edit.condition);
    assert.equal(product.knownDefects, edit.defects);
    assert.equal(product.measurements, edit.dimensions);
    assert.equal(product.functionality, edit.functionality);
    assert.equal(product.quantityTotal, edit.quantity);
    assert.equal(product.saleMode, edit.pickupMode);
    assert.deepEqual(product.includedAccessories, edit.includedAccessories);
  }
});

test('Volume 4 quantity counts sellable units rather than physical pieces inside bundles', () => {
  const sourceByItem = new Map(VOLUME4_ITEMS.map(product => [product.itemNumber, product]));
  const publicByItem = new Map(volume4PublicProducts().map(product => [product.itemNumber, product]));

  assert.deepEqual(
    VOLUME4_ITEMS.filter(product => product.quantityTotal > 1)
      .map(product => [product.itemNumber, product.quantityTotal]),
    [...separateSellableUnits]
  );

  for (const [itemNumber, expected] of bundleSellableUnits) {
    const source = sourceByItem.get(itemNumber);
    const product = publicByItem.get(itemNumber);
    assert.equal(source.quantityTotal, 1, `Item ${itemNumber} is one sellable bundle`);
    assert.match(source.description, expected.pieceCopy, `Item ${itemNumber} retains its internal piece count`);
    assert.equal(product.quantityTotal, 1);
    assert.equal(product.quantityRemaining, 1);
    assert.equal(product.askingPricePYG, expected.price, `Item ${itemNumber} price covers the entire bundle`);
    assert.equal(product.quantityTotal > 1 ? ' por unidad' : '', '');
    assert.equal(product.quantityTotal > 1 ? product.quantityRemaining : 1, 1, `Item ${itemNumber} cart max is one`);
  }

  for (const [itemNumber, quantity] of separateSellableUnits) {
    const source = sourceByItem.get(itemNumber);
    const product = publicByItem.get(itemNumber);
    assert.equal(source.quantityTotal, quantity, `Item ${itemNumber} retains separate sellable inventory`);
    assert.equal(product.quantityTotal, quantity);
    assert.equal(product.quantityRemaining, quantity);
    assert.match(`${source.title} ${source.description}`, /por unidad/i);
    assert.equal(product.quantityTotal > 1 ? ' por unidad' : '', ' por unidad');
    assert.equal(product.quantityTotal > 1 ? product.quantityRemaining : 1, quantity);
  }
});

test('storefront quantity labels and selectors remain driven by sellable quantity', async () => {
  const [staticStorefront, refreshedStorefront, productCard, cartPage] = await Promise.all([
    readFile(new URL('../../../js/site.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../js/volume2-storefront.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../source/components/product-card.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../../source/components/cart-page.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(staticStorefront, /product\.quantityTotal > 1 \? ' por unidad' : ''/);
  assert.match(staticStorefront, /product\.quantityTotal > 1 && !unavailable/);
  assert.match(refreshedStorefront, /const multiple = Number\(product\.quantityTotal \|\| 1\) > 1/);
  assert.match(refreshedStorefront, /\$\{multiple \? ' por unidad' : ''\}/);
  assert.match(productCard, /\(product\.quantityTotal \?\? 1\) > 1 \? ' por unidad' : ''/);
  assert.match(cartPage, /\(product\.quantityTotal \?\? 1\) > 1 \? <label>Cantidad/);
  assert.match(cartPage, /length: Math\.max\(0, product\.quantityRemaining \?\? 0\)/);
});

test('Volume 4 publishes 174 available products and Item 423 atomically as sold', async () => {
  assert.equal(VOLUME4_ITEMS.filter(item => item.status === 'AVAILABLE').length, 174);
  assert.equal(VOLUME4_ITEMS.filter(item => item.status === 'SOLD').length, 1);
  assert.equal(VOLUME4_ITEMS.filter(item => item.status === 'NEEDS_REVIEW').length, 0);
  assert.ok(VOLUME4_ITEMS.every(item => item.needsReview === false));
  assert.equal(VOLUME4_ITEMS.flatMap(item => item.photos).length, 311);
  assert.ok(retiredIds.every(itemNumber => !VOLUME4_ITEMS.some(item => item.itemNumber === itemNumber)));

  const projected = projectPublicCatalog(volume4PublicProducts(), []).products;
  assert.equal(projected.length, 175);
  const item423 = projected.find(item => item.itemNumber === 423);
  assert.equal(item423.status, 'SOLD');
  assert.equal(item423.quantityRemaining, 0);
  assert.equal(item423.quantitySold, item423.quantityTotal);

  const cartSource = await readFile(new URL('../cart-reservation.mjs', import.meta.url), 'utf8');
  assert.match(cartSource, /product\.status !== 'AVAILABLE'/);

  const handoff = JSON.parse(await readFile(
    new URL('../../../volume4/production-handoff.json', import.meta.url),
    'utf8'
  ));
  assert.equal(handoff.item423.requiredStatus, 'SOLD');
  assert.equal(handoff.item423.publicAvailabilityAllowed, false);
});

test('Item 133 adds only the owner-confirmed Rubbermaid branding to its source copy', () => {
  const item133 = VOLUME2_BATCH_ITEMS.find(item => item.itemNumber === 133);
  assert.equal(item133.title, 'Recipiente Rubbermaid morado con tapa');
  assert.equal(item133.description, 'Recipiente Rubbermaid morado con tapa.');
  assert.equal(item133.slug, 'recipiente-morado-con-tapa-133');
  assert.equal(item133.asking, 60_000);
  assert.equal(item133.quantityTotal, 1);
  assert.equal(item133.saleMode, 'IMMEDIATE');
  assert.deepEqual(item133.photos, ['IMG_7940.JPG', 'IMG_7941.JPG']);
  assert.equal(item133.condition, 'Estado visual según fotografías');
  assert.deepEqual(item133.includedAccessories, ['Recipiente y tapa visibles']);
});
