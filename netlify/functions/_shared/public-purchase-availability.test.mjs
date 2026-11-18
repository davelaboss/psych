import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {withPublicPurchaseAvailability} from './purchase-eligibility.mjs';
import {loadSaleCatalog} from './commerce.mjs';
import {createCartReservationHandler} from '../cart-reservation.mjs';
import {readSalePricingState,setInventoryDatabaseClientForTests} from './inventory-database.mjs';

const product=(n,price,extra={})=>({id:`item-${n}`,itemNumber:n,slug:`item-${n}`,title:`Artículo ${n}`,
 status:'AVAILABLE',currency:'PYG',saleMode:'IMMEDIATE',depositPercent:100,askingPricePYG:price,quantityTotal:1,quantityRemaining:1,...extra});

test('public availability describes free stock without changing asking price, status, or source objects',()=>{
 const p=product(84,15000,{quantityTotal:2,quantityRemaining:2}),before=structuredClone(p);
 const partial=withPublicPurchaseAvailability(p,{capacity:2,committed_quantity:0,purchasable_quantity:1});
 assert.equal(partial.purchasableQuantity,1);assert.equal(partial.purchaseBlockedByHold,false);
 const held=withPublicPurchaseAvailability(p,{capacity:2,committed_quantity:0,purchasable_quantity:0});
 assert.equal(held.purchasableQuantity,0);assert.equal(held.purchaseBlockedByHold,true);
 assert.equal(held.askingPricePYG,15000);assert.equal(held.status,'AVAILABLE');assert.deepEqual(p,before);
 assert.equal(withPublicPurchaseAvailability(p,undefined).purchasableQuantity,2);
 for(const stock of [{},{capacity:2,committed_quantity:0,purchasable_quantity:'bad'}])assert.equal(withPublicPurchaseAvailability(p,stock).purchasableQuantity,0);
 const inquiry=product(615,null,{saleMode:'INQUIRY',currency:'USD'});assert.equal(withPublicPurchaseAvailability(inquiry,undefined),inquiry);
 const sold={...p,status:'SOLD'};assert.equal(withPublicPurchaseAvailability(sold,undefined),sold);
});

test('real CART and protected ORDER holds block all four reported items; owner snapshot and partial/new stock stay intact',async()=>{
 const db=new PGlite();for(const name of ['20261001_operational_inventory','20261002_cart_extension','20261004_order_reservation_events',
 '20261005_pickup_notifications','20261006_notification_recipients','20261113_cart_pricing'])await db.exec(await readFile(new URL(`../../database/migrations/${name}.sql`,import.meta.url),'utf8'));
 const client={query:(...a)=>db.query(...a),release(){}};setInventoryDatabaseClientForTests({pool:{query:client.query,connect:async()=>client}});
 const buyer='11111111-1111-4111-8111-111111111111',holder='22222222-2222-4222-8222-222222222222';
 const products=[product(216,100000,{saleMode:'DELAYED',depositPercent:25}),product(275,50000),product(413,50000),product(447,55000),
 product(84,30000,{quantityTotal:2,quantityRemaining:2}),product(658,30000)];
 try{
  await db.query("INSERT INTO cart_sessions(session_id,expires_at) VALUES($1,clock_timestamp()+interval '2 hours')",[holder]);
  await db.query("INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot) VALUES('held-order',$1,'33333333-3333-4333-8333-333333333333',0,'local','{}')",[holder]);
  for(const p of products.slice(0,5)){
   await db.query('INSERT INTO operational_inventory(product_id,capacity) VALUES($1,$2)',[p.id,p.quantityTotal]);
   const isOrder=[216,275,413].includes(p.itemNumber),agreed={216:50000,275:25000,413:25000,447:55000,84:15000}[p.itemNumber];
   await db.query(`INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,order_id,expires_at,pricing_snapshot)
    VALUES($1,$2,1,$3,$4,${isOrder?'NULL':"clock_timestamp()+interval '2 hours'"},$5)`,[p.id,holder,isOrder?'ORDER':'CART',isOrder?'held-order':null,
    JSON.stringify({askingPricePYG:agreed,saleMode:p.saleMode,depositPercent:p.depositPercent})]);
  }
  const before=(await db.query('SELECT * FROM inventory_reservations ORDER BY product_id')).rows;
  const loadProducts=(origin,options)=>loadSaleCatalog(origin,options,{enabled:true,loadCatalog:async()=>products,readSalePricingState});
  const anonymous=await loadProducts('http://localhost',{cartSessionId:buyer});
  assert.ok(anonymous.slice(0,4).every(p=>p.purchaseBlockedByHold&&p.purchasableQuantity===0));
  assert.deepEqual(anonymous.slice(0,4).map(p=>p.askingPricePYG),[100000,50000,50000,55000]);
  assert.equal(anonymous[4].purchasableQuantity,1);assert.equal(anonymous[4].askingPricePYG,15000);
  assert.equal(anonymous[5].purchasableQuantity,1);assert.equal(anonymous[5].askingPricePYG,15000);
  const cart=createCartReservationHandler({loadProducts,recordEvent:async()=>{}});
  for(const p of products.slice(0,4)){
   const response=await cart(new Request('http://localhost/api/cart/reservation',{method:'POST',headers:{cookie:`psych_cart_session=${buyer}`,'content-type':'application/json'},body:JSON.stringify({action:'claim',productId:p.id,quantity:1})}));
   assert.equal(response.status,409);
  }
  const own=await loadProducts('http://localhost',{cartSessionId:holder});
  assert.equal(own[3].askingPricePYG,55000);assert.equal(own[3].purchaseBlockedByHold,false);
  assert.deepEqual((await db.query('SELECT * FROM inventory_reservations ORDER BY product_id')).rows,before);
  await db.query("DELETE FROM inventory_reservations WHERE product_id='item-447'"); // disposable local hold only
  const released=(await loadProducts('http://localhost',{cartSessionId:buyer})).find(p=>p.itemNumber===447);
  assert.equal(released.purchaseBlockedByHold,false);assert.equal(released.purchasableQuantity,1);
  assert.equal(released.askingPricePYG,27500);assert.equal(released.liquidation.percent,50);
 }finally{setInventoryDatabaseClientForTests(undefined);await db.close()}
});

test('held cards remain browsable with a reference price, reserved label and disabled action; counts separate holds',async()=>{
 const source=await readFile(new URL('../../../js/volume2-storefront.js',import.meta.url),'utf8');
 const context={document:{readyState:'loading',addEventListener(){},createElement(){return{dataset:{}}}},window:{}};
 runInNewContext(source.replace(/\}\)\(\);\s*$/,'globalThis.publicUi={renderCard,catalogAvailabilitySummary};\n})();'),context);
 const held=product(447,55000,{purchasableQuantity:0,purchaseBlockedByHold:true});
 const html=context.publicUi.renderCard(held).innerHTML;
 assert.match(html,/Precio de referencia · Reservado/);assert.match(html,/<button[^>]*disabled[^>]*>\s*Reservado/);
 assert.doesNotMatch(html,/DISPONIBLE AHORA|VENDIDO|Agregar al carrito/);
 assert.equal(context.publicUi.catalogAvailabilitySummary([held,product(38,12500)]),'1 artículo disponible · 1 reservado');
});

test('product boot does not expose an embedded available label before authoritative hold data arrives',async()=>{
 const source=await readFile(new URL('../../../js/site.js',import.meta.url),'utf8');
 const boot=source.slice(source.indexOf('async function bootStaticStorefront('),source.indexOf('async function setupLiquidationAnnouncement('));
 const window={location:{pathname:'/producto/item-447'},__staticCartReady:Promise.resolve()};let renders=0,lookups=0;
 const run=new Function('window','setupStaticMobileNavigation','setupLiquidationAnnouncement','getEmbeddedProductBySlug','renderProductDetail','updateStaticCartCount',
  `${boot};return bootStaticStorefront;`)(window,()=>{},()=>{},()=>{lookups++;return product(447,55000)},()=>{renders++},()=>{});
 await run();assert.equal(lookups,0);assert.equal(renders,0);
 window.__catalogProducts=[product(447,55000)];await run();assert.equal(renders,1);
});
