import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import * as phase2 from '../../../source/lib/phase2-batch.ts';
import * as volume2 from '../../../source/lib/volume2-batch.ts';
import * as supplemental from '../../../source/lib/sale-readiness-supplemental.ts';
import { loadBaseCatalog, loadCatalog, projectPublicCatalog, jsonResponse } from './commerce.mjs';
import { isMarketingEligible } from './marketing-email.mjs';
import { createCartReservationHandler } from '../cart-reservation.mjs';
import { REVIEW_DISPOSITIONS, applyReviewDisposition, isReviewArchived, reviewDisposition, ITEM_031_APPROVED_PUBLIC } from './review-dispositions.mjs';

const base = await loadBaseCatalog('https://example.test');
const byNumber = number => base.find(p => p.itemNumber === number);
const inventories = () => new Map([['real-20260828-31', {capacity: 2, committed_quantity: 1}]]);
const inputs = (overrides = [], inventory = inventories(), products = base) => ({
  loadBaseCatalog: async () => structuredClone(products),
  listProductOverrides: async () => structuredClone(overrides),
  readCommittedInventory: async () => structuredClone(inventory),
});
const handlerText = await readFile(new URL('../admin-legacy-inventory.mjs', import.meta.url), 'utf8');
function adminHandler(overrides = [], inventory = inventories()) {
  const bindings = { ...phase2, ...volume2, ...supplemental,
    adminAuthorized: () => true, jsonResponse, applyReviewDisposition, isReviewArchived, reviewDisposition,
    loadBaseCatalog: async () => base,
    loadCatalog: url => loadCatalog(url, inputs(overrides, inventory)),
    listProductOverrides: async () => overrides,
  };
  const body = handlerText.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/gm, '')
    .replace('export default async function handler', 'async function handler');
  return new Function(...Object.keys(bindings), `${body}\nreturn handler;`)(...Object.values(bindings));
}

test('all twelve decisions resolve without new IDs; seven histories remain private and review reaches zero', async () => {
  const response = await adminHandler()(new Request('https://example.test/api/admin/legacy-inventory'));
  const { products, archivedProducts } = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(archivedProducts.map(p => p.itemNumber), [17,44,53,111,117,118,128]);
  assert.equal(products.filter(p => !p.published).length, 0);
  for (const decision of REVIEW_DISPOSITIONS) {
    const product = [...products, ...archivedProducts].find(p => p.id === decision.id);
    assert.equal(product.itemNumber, decision.itemNumber);
    assert.deepEqual(product.reviewDisposition, decision);
    assert.ok(product.photoFiles.length > 0);
    if (decision.disposition === 'ARCHIVED') {
      assert.equal(products.some(p => p.id === decision.id), false);
      assert.equal(base.some(p => p.id === decision.id), false);
    }
  }
  const curtain = archivedProducts.find(p => p.itemNumber === 117);
  const original = volume2.VOLUME2_BATCH_ITEMS.find(p => p.itemNumber === 117);
  assert.equal(curtain.description, original.description);
  assert.equal(curtain.askingPricePYG, 90000);
  assert.deepEqual(curtain.photoFiles, original.photos);
  assert.equal([...products, ...archivedProducts].filter(p => p.itemNumber === 117).length, 1);
});

test('restorations retain approved details and photos and newer seller fields remain authoritative', async () => {
  const p31 = byNumber(31), p90 = byNumber(90);
  assert.equal(p31.askingPricePYG, 25000);
  assert.equal(p31.quantityTotal, 2);
  assert.equal(p31.title, 'Tradescantia morada con maceta (cada una)');
  assert.deepEqual(p31.includedAccessories, ['1 planta Tradescantia morada', '1 maceta']);
  assert.match(p31.description, /La mesa no está incluida/);
  assert.doesNotMatch(p31.description, /soporte|2 plantas|dos unidades/);
  for (const field of ['description','conditionNotes','knownDefects']) {
    assert.equal(p31[field], ITEM_031_APPROVED_PUBLIC[field] + (field==='description'?' Queda 1 planta disponible.':''));
  }
  assert.deepEqual(p31.images, []);
  assert.equal(p90.askingPricePYG, 750000);
  assert.equal(p90.images.length, 6);
  assert.match(p90.description, /delantera derecha.*automático no funciona/);
  assert.match(p90.knownDefects, /automático no funciona/);
  assert.deepEqual([p90.saleMode,p90.pickupWindowStart,p90.pickupWindowEnd], ['DELAYED','2026-12-09','2026-12-12']);
  const overrides = [p31,p90].map(p => ({productId:p.id,
    publicFields:{title:`Confirmado ${p.itemNumber}`,askingPricePYG:123456,description:'Texto posterior',knownDefects:'Detalle posterior'},
    images:['/admin-new.jpg','/admin-second.jpg'], internalFields:{internalNotes:'Private'},
  }));
  const snapshot = structuredClone(overrides);
  for (let i=0;i<2;i++) {
    const resolved = await loadCatalog('https://example.test', inputs(overrides));
    for (const p of [p31,p90]) {
      const actual = resolved.find(a => a.id === p.id);
      assert.equal(actual.askingPricePYG,123456);
      assert.equal(actual.description,p.itemNumber===31?'Texto posterior. Queda 1 planta disponible.':'Texto posterior');
      assert.deepEqual(actual.images,overrides[0].images);
      assert.equal(actual.quantityRemaining,1);
      assert.equal(actual.status,'AVAILABLE');
      assert.equal(Object.hasOwn(actual,'reviewDisposition'),false);
      assert.equal(Object.hasOwn(actual,'internalNotes'),false);
    }
  }
  assert.deepEqual(overrides,snapshot);
});

test('Item 031 withholds ambiguous originals, preserves both historical files, and accepts new seller photos', async () => {
  const original=phase2.PHASE2_BATCH_ITEMS.find(p=>p.itemNumber===31);
  assert.deepEqual(original.photos,['IMG_7723.JPG','IMG_7729.JPG']);
  const images=['assets/media/real-20260828-31-0.jpg?v=1789320365792',
    '/assets/media/real-20260828-31-1.jpg',
    'https://thelabossieres.com/.netlify/images?url=%2Fassets%2Fmedia%2Freal-20260828-31-0.jpg'];
  const overrides=[{productId:original.id,images}];
  const current=(await loadCatalog('',inputs(overrides))).find(p=>p.itemNumber===31);
  assert.deepEqual(current.images,[]);
  assert.deepEqual(overrides[0].images,images);
  const admin=await (await adminHandler(overrides)(new Request('https://example.test/api/admin/legacy-inventory'))).json();
  assert.deepEqual(admin.products.find(p=>p.itemNumber===31).photoFiles,original.photos);
  const newer=(await loadCatalog('',inputs([{productId:original.id,images:['/.netlify/functions/product-photo?key=31%2Fnew-seller-photo']}]))).find(p=>p.itemNumber===31);
  assert.deepEqual(newer.images,['/.netlify/functions/product-photo?key=31%2Fnew-seller-photo']);
});

test('Item 031 ignores obsolete source overrides, corrects two-plant copy and never offers more than the original two', async () => {
  const historical = phase2.PHASE2_BATCH_ITEMS.find(p=>p.itemNumber===31);
  const override = { productId: byNumber(31).id, publicFields: {
    title: historical.title, askingPricePYG: historical.asking,
    description: historical.description, includedAccessories: [],
    conditionNotes: historical.conditionNotes, knownDefects: historical.knownDefects,
    quantityTotal: 9, quantityRemaining: 9,
  }};
  const inventory = new Map([[byNumber(31).id,{capacity:9,committed_quantity:1}]]);
  const get = async overrides => (await loadCatalog('',inputs(overrides,inventory))).find(p=>p.itemNumber===31);
  const current = await get([override]);
  assert.equal(current.title,ITEM_031_APPROVED_PUBLIC.title);
  assert.equal(current.askingPricePYG,25000);
  assert.deepEqual(current.includedAccessories,ITEM_031_APPROVED_PUBLIC.includedAccessories);
  assert.deepEqual([current.quantityTotal,current.quantityRemaining,current.quantitySold],[2,1,1]);
  assert.match(current.description,/Queda 1 planta disponible/);
  assert.doesNotMatch(current.description,/soporte|2 plantas|dos unidades/);
  const oldCopy = 'Tradescantia morada con maceta, vendida por unidad. Hay 2 plantas disponibles y cada foto muestra una de las dos unidades. El precio corresponde a una planta con su maceta. La mesa no está incluida.';
  const latest = {productId:current.id,publicFields:{description:oldCopy,askingPricePYG:25000}};
  const corrected = await get([latest]);
  assert.equal(corrected.description,ITEM_031_APPROVED_PUBLIC.description+' Queda 1 planta disponible.');
  inventory.set(current.id,{capacity:9,committed_quantity:2});
  const sold = await get([latest]);
  assert.equal(sold.quantityRemaining,0);
  assert.equal(sold.status,'SOLD');
  assert.match(sold.description,/No quedan plantas disponibles/);
  assert.doesNotMatch(sold.description,/Queda 1|2 plantas|dos unidades/);
});

test('gift overrides cannot recreate stock, prices or the wrong game identity', async () => {
  const overrides = [96,132,137].map(n => ({productId:byNumber(n).id,
    publicFields:{status:'AVAILABLE',askingPricePYG:90000,quantityRemaining:9,quantityTotal:n===96?2:1,
      ...(n===137?{title:'Kit de cuentas',description:'Manualidades'}:{})},images:['/original-admin.jpg']}));
  const result = await loadCatalog('https://example.test',inputs(overrides));
  for (const number of [96,132,137]) {
    const p = result.find(p => p.itemNumber === number);
    assert.deepEqual([p.status,p.askingPricePYG,p.quantityRemaining,p.quantitySold], ['SOLD',0,0,0]);
    assert.equal(isMarketingEligible(p),false);
    assert.deepEqual(p.images,['/original-admin.jpg']);
    assert.equal(Object.hasOwn(p,'payments'),false);
    assert.equal(Object.hasOwn(p,'buyer'),false);
  }
  assert.equal(result.find(p => p.itemNumber===96).quantityTotal,1);
  assert.equal(result.find(p => p.itemNumber===137).title,'Juego 7 en 1');
  assert.equal(result.find(p => p.itemNumber===137).description,'Juego con siete juegos diferentes.');
});

test('committed units, missing plant capacity and gift conflicts fail safely without changing records', async () => {
  for (const row of [undefined,{capacity:1,committed_quantity:1},{capacity:2,committed_quantity:0}]) {
    const map = row ? new Map([[byNumber(31).id,row]]) : new Map();
    const p = (await loadCatalog('',inputs([],map))).find(p=>p.itemNumber===31);
    assert.equal(p.status,'NEEDS_REVIEW');
    assert.equal(p.quantityRemaining,0);
  }
  const inventory = inventories();
  inventory.set(byNumber(31).id,{capacity:2,committed_quantity:2});
  inventory.set(byNumber(96).id,{capacity:1,committed_quantity:1});
  const snapshot=structuredClone(inventory);
  const result=await loadCatalog('',inputs([],inventory));
  assert.equal(result.find(p=>p.itemNumber===31).status,'SOLD');
  assert.equal(result.find(p=>p.itemNumber===96).status,'NEEDS_REVIEW');
  const admin=await (await adminHandler([],inventory)(new Request('https://example.test/api/admin/legacy-inventory'))).json();
  assert.deepEqual(admin.products.filter(p=>!p.published).map(p=>p.itemNumber),[96]);
  assert.deepEqual(inventory,snapshot);
});

test('archives stay excluded despite stale AVAILABLE overrides; all unavailable items reject checkout', async () => {
  const archives=REVIEW_DISPOSITIONS.filter(p=>p.disposition==='ARCHIVED');
  const products=base.concat(archives.map(p=>({...p,status:'AVAILABLE',quantityRemaining:1})));
  const resolved=await loadCatalog('',inputs(archives.map(p=>({productId:p.id,publicFields:{status:'AVAILABLE'}})),inventories(),products));
  assert.equal(resolved.some(isReviewArchived),false);
  const publicProducts=projectPublicCatalog(resolved,[]).products;
  assert.equal(publicProducts.filter(p=>[31,90].includes(p.itemNumber)).length,2);
  let claims=0;
  const handler=createCartReservationHandler({loadProducts:async()=>resolved,salesOpen:()=>true,
    claimLease:async args=>{claims++;return args;},recordEvent:async()=>{}});
  for (const entry of REVIEW_DISPOSITIONS) {
    const response=await handler(new Request('https://example.test/api/cart/reservation',{
      method:'POST',headers:{cookie:'psych_cart_session=00000000-0000-4000-8000-000000000001'},
      body:JSON.stringify({action:'claim',productId:entry.id,quantity:1}),
    }));
    assert.equal(response.status,entry.disposition==='RESTORED'?200:409,entry.id);
  }
  assert.equal(claims,2);
});

test('the guarded plant adjustment is repeatable and cannot undo or recreate a sale', async () => {
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE operational_inventory(product_id text,capacity int,committed_quantity int,updated_at timestamptz);
      CREATE TABLE checkout_attempts(order_id text,committed_at timestamptz,order_snapshot jsonb);
      CREATE TABLE inventory_reservations(order_id text,product_id text,phase text,quantity int);
      INSERT INTO operational_inventory VALUES('real-20260828-31',1,1,now()),('unrelated',1,1,now());
      INSERT INTO checkout_attempts VALUES('VM-2026-042A512D',now(),'{"status":"PAYMENT_CONFIRMED"}');
      INSERT INTO inventory_reservations VALUES('VM-2026-042A512D','real-20260828-31','COMMITTED',1);`);
    const sql=await readFile(new URL('../../database/migrations/20261021_item031_remaining_plant.sql',import.meta.url),'utf8');
    const before=(await db.query('SELECT * FROM checkout_attempts')).rows;
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual((await db.query('SELECT capacity,committed_quantity FROM operational_inventory ORDER BY product_id')).rows,
      [{capacity:2,committed_quantity:1},{capacity:1,committed_quantity:1}]);
    await db.exec("UPDATE operational_inventory SET committed_quantity=2 WHERE product_id='real-20260828-31'");
    await db.exec(sql);
    assert.equal((await db.query("SELECT capacity FROM operational_inventory WHERE product_id='real-20260828-31'")).rows[0].capacity,2);
    assert.deepEqual((await db.query('SELECT * FROM checkout_attempts')).rows,before);
  } finally { await db.close(); }
});
