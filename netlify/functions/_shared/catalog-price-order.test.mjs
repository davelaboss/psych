import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const controller = await readFile(new URL('../../../js/volume2-storefront.js', import.meta.url), 'utf8');
const context = {document: {readyState: 'loading', addEventListener() {}, createElement() {return {dataset:{}};}}, window: {}};
runInNewContext(controller.replace(/\}\)\(\);\s*$/, 'globalThis.catalog = {sortProducts, filterProducts, sortingPricePYG, catalogSnapshotFromValues, renderCard};\n})();'), context);
const {sortProducts, filterProducts, sortingPricePYG, catalogSnapshotFromValues, renderCard} = context.catalog;
const product = (itemNumber, askingPricePYG, extra = {}) => ({
  id: `item-${itemNumber}`, itemNumber, askingPricePYG, status: 'AVAILABLE',
  title: `Product ${itemNumber}`, category: 'Hogar', saleMode: 'IMMEDIATE',
  description: '', condition: 'Buen estado', images: [], quantityRemaining: 1,
  dateListed: '2026-11-09', ...extra,
});
const tracker = product(615, null, {id: 'real-202611-volume6-615', title: 'Chevrolet Tracker',
  category: 'Vehículos', currency: 'USD', askingPriceUSD: 18000, saleMode: 'INQUIRY', purchasable: false});
const criteria = {query: '', category: '', availability: 'ALL', condition: 'ALL', maxPrice: 0, showSold: false};

test('default sorts live effective prices descending, including USD; sold remains hidden', () => {
  const list = filterProducts([product(45,350000), product(1,395000,{status:'SOLD',quantityRemaining:0}),
    product(274,3500000), product(92,395000), tracker], criteria);
  sortProducts(list);
  assert.deepEqual(Array.from(list, p=>p.itemNumber), [615,274,92,45]);
});

test('mixed currencies interleave by value in both directions, rather than by currency', () => {
  const list = [product(2,1000000), product(3,0,{currency:'USD',askingPriceUSD:100}), tracker];
  sortProducts(list,'price-asc');
  assert.deepEqual(list.map(p=>p.itemNumber),[3,2,615]);
  sortProducts(list,'price-desc');
  assert.deepEqual(list.map(p=>p.itemNumber),[615,2,3]);
  assert.equal(sortingPricePYG(tracker),112071780);
});

test('null, zero and malformed prices remain browsable after known prices, never used as zero', () => {
  const list = [product(4,null),product(2,0),product(3,'bad'),product(1,100)];
  for (const mode of ['price-desc','price-asc']) {
    const visible = filterProducts(list,criteria);
    sortProducts(visible,mode);
    assert.deepEqual(Array.from(visible,p=>p.itemNumber),[1,2,3,4]);
  }
  assert.equal(sortingPricePYG(product(5,100,{currency:'USD',askingPriceUSD:null})),null);
});

test('Tracker remains in all, vehicle, immediate and search results with inquiry action', () => {
  for (const changed of [{},{category:'vehiculos'},{availability:'IMMEDIATE'},{query:'tracker'},{query:'item 615'}]) {
    assert.equal(filterProducts([tracker],{...criteria,...changed}).length,1);
  }
  assert.equal(filterProducts([tracker],{...criteria,availability:'DELAYED'}).length,0);
  const card = renderCard(tracker).innerHTML;
  assert.match(card,/US\$18,000/);
  assert.match(card,/Consultar por WhatsApp/);
  assert.doesNotMatch(card,/data-cart-action|Agregar al carrito|Gratis/);
});

test('sorting leaves original prices, quantities, inquiry mode and product objects untouched', () => {
  const list = [product(45,350000),tracker,product(274,3500000)];
  const original = structuredClone(list);
  sortProducts(list);
  for (const p of list) assert.deepEqual(p,original.find(q=>q.id===p.id));
});

test('legacy default history migrates while explicit choices survive returns and refresh', () => {
  for (const saved of [{},{sort:'catalog'},{sort:'invalid'},{sort:'catalog',sortExplicit:false}]) {
    assert.equal(catalogSnapshotFromValues(saved).sort,'price-desc');
  }
  for (const sort of ['newest','price-asc','price-desc']) {
    assert.equal(catalogSnapshotFromValues({sort}).sort,sort);
  }
  const explicit = catalogSnapshotFromValues({sort:'catalog',sortExplicit:true,search:'mesa',category:'Muebles',renderedCount:144,scrollY:6000});
  assert.equal(catalogSnapshotFromValues(explicit).sort,'catalog');
  assert.equal(explicit.search,'mesa'); assert.equal(explicit.renderedCount,144); assert.equal(explicit.scrollY,6000);
});

test('explicit catalog and newest options remain available; deterministic price ties', () => {
  const list = [product(4,100),product(2,100),tracker];
  sortProducts(list,'catalog'); assert.deepEqual(list.map(p=>p.itemNumber),[2,4,615]);
  sortProducts(list,'price-desc'); assert.deepEqual(list.map(p=>p.itemNumber),[615,2,4]);
  sortProducts(list,'newest'); assert.deepEqual(list.map(p=>p.itemNumber),[615,4,2]);
});
