import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { VOLUME4_ITEMS } from '../../../source/lib/volume4-batch.mjs';
import { projectPublicCatalog } from './commerce.mjs';
import { catalogBatchProducts } from './volume2-public.mjs';

const volume4PublicProducts = () => catalogBatchProducts()
  .filter(product => product.itemNumber >= 327);

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

test('Volume 4 publication safeguards and Item 423 SOLD handoff remain intact', async () => {
  assert.ok(VOLUME4_ITEMS.every(item => item.status === 'NEEDS_REVIEW' && item.needsReview === true));
  assert.equal(projectPublicCatalog(volume4PublicProducts(), []).products.length, 0);

  const handoff = JSON.parse(await readFile(
    new URL('../../../volume4/production-handoff.json', import.meta.url),
    'utf8'
  ));
  assert.equal(handoff.item423.requiredStatus, 'SOLD');
  assert.equal(handoff.item423.publicAvailabilityAllowed, false);
});
