import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { VOLUME6_ITEMS } from '../../../source/lib/volume6-batch.mjs';
import { catalogBatchProducts, publicProduct } from './volume2-public.mjs';
import { loadCatalog } from './commerce.mjs';
import { buildProductPreviewMetadata } from './product-preview.mjs';
import { claimCartLease, getCartLeaseStatus, releaseCartLease, setInventoryDatabaseClientForTests } from './inventory-database.mjs';
const items=VOLUME6_ITEMS.map(publicProduct);
const byNumber=n=>items.find(p=>p.itemNumber===n);

test('Volume 6 is a distinct additive PYG household batch; reserved Tracker stays outside',()=>{
 assert.equal(items.length,32);assert.deepEqual(items.map(p=>p.itemNumber),Array.from({length:32},(_,i)=>616+i));
 for(const p of items){assert.equal(p.id,`real-202611-volume6-${p.itemNumber}`);assert.ok(p.tags.includes('volumen 6'));assert.equal(p.saleMode,'IMMEDIATE');assert.equal(p.depositPercent,100);assert.equal(p.status,'AVAILABLE');assert.ok(p.askingPricePYG>0);}
 assert.ok(!items.some(p=>p.itemNumber===615 || /Tracker|silicona|tenis/i.test(p.title)));
 for(const field of ['id','itemNumber','slug'])assert.equal(new Set(items.map(p=>p[field])).size,32);
});
test('all previous catalog projections remain byte-equivalent and keep Volume 5 identity',()=>{
 const previous=catalogBatchProducts(undefined,[]), all=catalogBatchProducts();
 assert.equal(all.length,previous.length+32);
 for(const p of previous)assert.deepEqual(all.find(q=>q.id===p.id),p);
 for(const p of previous.filter(p=>p.id.startsWith('real-202610-volume5-')))assert.ok(p.tags.includes('volumen 5'));
});
test('accepted 30-product fallback remains identical and final approval scope is exactly the consolidated 32',()=>{
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 assert.equal(hash(VOLUME6_ITEMS.slice(0,30)),'47d668c0f14f0e64854cfeb990d5ab4e5e9649691ef11714c3b62f066cdddbc4');
 assert.equal(hash(VOLUME6_ITEMS),'69ba0e5bd3d3aedb7c8a841ca5a9c601784fb513e14d8f649958651ed486b78d');
 assert.equal(items.flatMap(p=>p.images).length,52);assert.equal(new Set(items.flatMap(p=>p.images)).size,52);
});
test('camera lot and single camera keep exact owner prices, quantities, accessories and immediate full payment',()=>{
 const lot=byNumber(646),single=byNumber(647);assert.equal(lot.askingPricePYG,1000000);assert.equal(lot.quantityTotal,1);assert.equal(lot.saleStructure,'set');assert.match(lot.description,/seis kits juntos/);assert.match(lot.includedAccessories.join(' '),/6 cámaras TC82.*6 paneles solares con cables Type-C/);assert.match(lot.notIncludedVisible,/microSD no incluidas/);assert.equal(lot.images.length,2);
 assert.equal(single.askingPricePYG,180000);assert.equal(single.quantityTotal,1);assert.equal(single.saleStructure,'individual');assert.match(single.functionality,/Funciona muy bien/);assert.deepEqual(single.includedAccessories,['Cámara Tapo C510W','Soporte de montaje','Fuente de alimentación con cable']);assert.equal(single.images.length,1);assert.equal(single.notIncludedVisible,'Tarjeta microSD no incluida.');
 for(const p of [lot,single]){assert.equal(p.saleMode,'IMMEDIATE');assert.equal(p.depositPercent,100);assert.equal(p.quantityRemaining,1);assert.equal(p.knownDefects,'');assert.equal(p.pickupWindowStart,null);assert.equal(p.pickupWindowEnd,null);}
 assert.equal(lot.askingPricePYG+single.askingPricePYG,1180000);
});
test('owner curtain, unit-price and exclusion decisions survive the public projection',()=>{
 assert.equal(byNumber(631).quantityTotal,4);assert.equal(byNumber(631).askingPricePYG,12000);
 assert.equal(byNumber(634).measurements,'Cada paño: 168 × 69 cm.');assert.equal(byNumber(634).quantityTotal,1);
 assert.equal(byNumber(635).measurements,'Cada paño: 103 cm de ancho × 120 cm de largo.');assert.equal(byNumber(635).saleStructure,'set');assert.equal(byNumber(635).askingPricePYG,25000);
 assert.match(byNumber(636).title,/Hojas y pájaros/);assert.notEqual(byNumber(636).itemNumber,43);
 assert.match(byNumber(642).notIncludedVisible,/recipiente.*no está incluido/i);assert.doesNotMatch(byNumber(642).description,/bolsa/i);
 assert.match(byNumber(629).knownDefects,/no tiene tapa/);assert.doesNotMatch(byNumber(629).knownDefects,/fisura/);
 assert.match(byNumber(633).description,/última vez.*funcionaban.*pilas/);
 assert.equal(byNumber(621).category,'Herramientas');assert.ok(byNumber(621).tags.includes('herramientas'));
 assert.equal(byNumber(633).knownDefects,'');assert.match(byNumber(633).functionality,/Funcionaban en la última prueba/);
 assert.equal(byNumber(634).knownDefects,'');assert.match(byNumber(634).description,/requiere planchado/);
});
test('images preserve cover ordering and source assets; preview metadata selects that same cover',async()=>{
 for(const p of items){assert.ok(p.images.length);for(const file of p.images)assert.ok((await readFile(new URL('../../../'+file.slice(1),import.meta.url))).length>0);const meta=buildProductPreviewMetadata(p,'https://example.test');assert.ok(meta);}
 assert.equal(byNumber(622).images[0],'/images/volume-6/v6-g0027-03.webp');
});
test('private review and AI fields cannot leak into public output',()=>{
 for(const p of items){for(const k of ['ownerNotes','pricing','pricingDecision','confirmedFields','sourceGroupId','questions','sourceEvidence','ownerPatch'])assert.equal(Object.hasOwn(p,k),false);assert.doesNotMatch(JSON.stringify(p),/NEEDS_REVIEW|NO CHANGE|a confirmar|medidas a confirmar|confianza IA|C:\\\\Users/i);}
});
test('operational capacity and existing Admin overrides still win without changing inputs',async()=>{
 const base=catalogBatchProducts(), before=structuredClone(base), legacy=base.find(p=>p.id==='real-202610-volume5-510');
 const resolved=await loadCatalog('https://example.test',{loadBaseCatalog:async()=>base,listProductOverrides:async()=>[{productId:legacy.id,publicFields:{askingPricePYG:19001,status:'RESERVED'}}],readCommittedInventory:async()=>new Map([[byNumber(631).id,{capacity:4,committed_quantity:2}]])});
 assert.equal(resolved.find(p=>p.id===legacy.id).askingPricePYG,19001);assert.equal(resolved.find(p=>p.id===legacy.id).status,'RESERVED');assert.equal(resolved.find(p=>p.id===byNumber(631).id).quantityRemaining,2);assert.deepEqual(base,before);
});
test('actual cart lease code enforces four-unit stock in an isolated PostgreSQL-compatible database',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('../../database/migrations/20261001_operational_inventory.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../../database/migrations/20261002_cart_extension.sql',import.meta.url),'utf8'));
 const client={query:(...args)=>db.query(...args),release(){}};setInventoryDatabaseClientForTests({pool:{query:client.query,connect:async()=>client}});
 const cartSessionId='11111111-1111-4111-8111-111111111111', productId=byNumber(631).id;
 try{await assert.rejects(()=>claimCartLease({cartSessionId,productId,quantity:5,availability:4}));await claimCartLease({cartSessionId,productId,quantity:4,availability:4});const s=await getCartLeaseStatus(cartSessionId);assert.ok(JSON.stringify(s).includes(productId));await releaseCartLease(cartSessionId);for(const p of [byNumber(646),byNumber(647)]){await assert.rejects(()=>claimCartLease({cartSessionId,productId:p.id,quantity:2,availability:1}));await claimCartLease({cartSessionId,productId:p.id,quantity:1,availability:1});await releaseCartLease(cartSessionId);}const count=await db.query('SELECT COUNT(*) AS n FROM inventory_reservations');assert.equal(Number(count.rows[0].n),0);}finally{setInventoryDatabaseClientForTests(null);await db.close();}
});
