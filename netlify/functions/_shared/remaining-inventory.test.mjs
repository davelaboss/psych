import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {VOLUME6_REMAINING} from '../../../source/lib/volume6-remaining.mjs';
import {catalogBatchProducts,publicProduct} from './volume2-public.mjs';
import {createCartReservationHandler} from '../cart-reservation.mjs';
import createOrder from '../create-order.mjs';
import {injectProductPreviewMetadata} from './product-preview.mjs';
import {isInquiryOnlyProduct} from './purchase-eligibility.mjs';
import {loadCatalog} from './commerce.mjs';

const products=VOLUME6_REMAINING.filter(p=>p.itemNumber<660).map(publicProduct),tracker=products.find(p=>p.itemNumber===615);
test('remaining approval prices, selling units, disclosures and delayed terms survive public projection',()=>{
 assert.equal(products.length,13);assert.deepEqual(products.filter(p=>p.itemNumber!==615).map(p=>p.askingPricePYG),[20000,60000,15000,2000,15000,15000,15000,10000,20000,45000,30000,12000]);
 assert.equal(products.find(p=>p.itemNumber===650).quantityTotal,2);assert.equal(products.find(p=>p.itemNumber===651).quantityTotal,8);
 for(const n of [654,655,656]){assert.equal(products.find(p=>p.itemNumber===n).saleStructure,'set');assert.equal(products.find(p=>p.itemNumber===n).quantityTotal,1);}
 for(const n of [649,652,653,657]){const p=products.find(p=>p.itemNumber===n);assert.equal(p.saleMode,'DELAYED');assert.equal(p.depositPercent,25);assert.equal(p.pickupWindowStart,'2026-12-09');assert.equal(p.pickupWindowEnd,'2026-12-12');}
 assert.match(products.find(p=>p.itemNumber===658).knownDefects,/costura.*velcro.*floja/);assert.match(products.find(p=>p.itemNumber===659).images[0],/g0018-03/);
 for(const p of products)assert.doesNotMatch(JSON.stringify(p),/NO CHANGE|ownerPatch|confirmedFields|sourceEvidence|C:\\\\Users/);
});
test('Tracker uses genuine USD inquiry mode, approved specs and nine authentic photos',async()=>{
 assert.equal(tracker.currency,'USD');assert.equal(tracker.askingPriceUSD,18000);assert.equal(tracker.askingPricePYG,null);assert.equal(tracker.depositPercent,null);assert.equal(tracker.purchasable,false);assert.equal(tracker.saleMode,'INQUIRY');assert.equal(tracker.images.length,9);assert.match(tracker.description,/10.695 km al 06\/11\/2026.*1.2 Turbo Flex.*automática de 6.*Entrega inmediata/);
 for(const p of products)for(const image of p.images)assert((await readFile(new URL('../../../'+image.slice(1),import.meta.url))).length>0);
 const html=injectProductPreviewMetadata('<head></head>',tracker,'https://thelabossieres.com');assert.match(html,/US\$18,000/);assert.match(html,/product:price:currency" content="USD"/);assert.match(html,/tracker-615-01/);
});
test('all previous source records are unchanged; existing overrides and stock still win',async()=>{
 const before=catalogBatchProducts(undefined,undefined,[]),after=catalogBatchProducts(undefined,undefined,VOLUME6_REMAINING.filter(p=>p.itemNumber<=660));assert.equal(after.length,before.length+14);
 for(const p of before)assert.deepEqual(after.find(q=>q.id===p.id),p);
 const p=before.find(p=>p.itemNumber===605);const live=await loadCatalog('https://example.test',{loadBaseCatalog:async()=>after,listProductOverrides:async()=>[{productId:p.id,publicFields:{askingPricePYG:195000,status:'RESERVED'}}],readCommittedInventory:async()=>new Map([[products[3].id,{capacity:8,committed_quantity:2}]])});
 assert.equal(live.find(q=>q.id===p.id).askingPricePYG,195000);assert.equal(live.find(q=>q.id===p.id).status,'RESERVED');assert.equal(live.find(q=>q.id===products[3].id).quantityRemaining,6);
});
test('direct vehicle claim and quantity calls reject before any reservation or analytics write',async()=>{
 let writes=0;const route=createCartReservationHandler({salesOpen:()=>true,loadProducts:async()=>products,claimLease:async()=>{writes++;},updateLease:async()=>{writes++;},recordEvent:async()=>{writes++;}});
 for(const action of ['claim','quantity']){const response=await route(new Request('https://example.test/api/cart-reservation',{method:'POST',headers:{'content-type':'application/json',cookie:'psych_cart_session=11111111-1111-4111-8111-111111111111'},body:JSON.stringify({action,productId:tracker.id,quantity:1})}));assert.equal(response.status,409);assert.match((await response.json()).error,/trato privado/);}assert.equal(writes,0);
 assert(isInquiryOnlyProduct({...tracker,saleMode:'IMMEDIATE',currency:'PYG'}));
});
test('direct vehicle order request rejects before checkout recovery or payment construction',async()=>{
 const response=await createOrder(new Request('https://example.test/api/create-order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{productId:tracker.id,quantity:1}]})}));assert.equal(response.status,409);assert.match((await response.json()).error,/trato privado/);
});
