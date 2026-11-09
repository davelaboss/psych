import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { VOLUME6_REMAINING } from '../../../source/lib/volume6-remaining.mjs';
import { publicProduct, catalogBatchProducts } from './volume2-public.mjs';
import { claimCartLease, releaseCartLease, setInventoryDatabaseClientForTests } from './inventory-database.mjs';

const source = VOLUME6_REMAINING.find(p => p.itemNumber === 660);
const product = publicProduct(source);

test('G009/G014 publish as one complete owner-approved kit for PYG 275000', async () => {
  assert.equal(product.id, 'real-202611-volume6-660');
  assert.equal(product.askingPricePYG, 275000);
  assert.equal(product.quantityTotal, 1);
  assert.equal(product.quantityRemaining, 1);
  assert.equal(product.saleStructure, 'set');
  assert.equal(product.saleMode, 'IMMEDIATE');
  assert.equal(product.depositPercent, 100);
  assert.deepEqual(product.includedAccessories, [
    '6 estantes de madera contrachapada barnizada',
    '6 rieles de pared de 1 metro',
    '15 soportes de 30 cm',
    '6 soportes de 40 cm',
  ]);
  assert.deepEqual(product.images, ['/images/volume-6/v6-g0014-01.webp', '/images/volume-6/v6-g0009-01.webp']);
  for (const image of product.images) assert((await readFile(new URL('../../../' + image.slice(1), import.meta.url))).length > 0);
  assert.match(product.description, /únicamente el conjunto completo/);
  assert.doesNotMatch(JSON.stringify(product), /a confirmar|NEEDS_REVIEW|ownerPatch|sourceEvidence/);
});

test('all thirteen earlier source listings remain identical and only one new permanent ID is added', () => {
  const text = execFileSync('git', ['show', '5a5f2126b0c6955e3be52703697401b26ab5fb8c:source/lib/volume6-remaining.mjs'], { encoding: 'utf8' });
  const previous = JSON.parse(text.split('Object.freeze(')[1].trim().slice(0, -2));
  assert.deepEqual(VOLUME6_REMAINING.filter(p => p.itemNumber < 660), previous);
  assert.equal(VOLUME6_REMAINING.filter(p => p.itemNumber <= 660).length, previous.length + 1);
  const catalog = catalogBatchProducts();
  assert.equal(catalog.filter(p => p.itemNumber === 660).length, 1);
  for (const field of ['id', 'itemNumber', 'slug']) assert.equal(new Set(catalog.map(p => p[field])).size, catalog.length);
});

test('one kit can be held as one lot; a two-kit request fails in isolated inventory', async () => {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../../database/migrations/20261001_operational_inventory.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../database/migrations/20261002_cart_extension.sql', import.meta.url), 'utf8'));
  const query = (...args) => db.query(...args);
  setInventoryDatabaseClientForTests({ pool: { query, connect: async () => ({ query, release() {} }) } });
  const cartSessionId = '11111111-1111-4111-8111-111111111111';
  try {
    await assert.rejects(() => claimCartLease({ cartSessionId, productId: product.id, quantity: 2, availability: 1 }));
    await claimCartLease({ cartSessionId, productId: product.id, quantity: 1, availability: 1 });
    await releaseCartLease(cartSessionId);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM inventory_reservations')).rows[0].n), 0);
  } finally { setInventoryDatabaseClientForTests(null); await db.close(); }
});
