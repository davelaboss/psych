import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {withdrawFromSale} from './owner-withdrawal.mjs';
import {loadCatalog,projectPublicCatalog} from './commerce.mjs';
import {claimCartLease,readCommittedInventory,setInventoryDatabaseClientForTests,confirmOrderPayment,recordOrderReceipt} from './inventory-database.mjs';
import {createWithdrawalHandler} from '../admin-withdraw-product.mjs';
import {createCartReservationHandler} from '../cart-reservation.mjs';
import {createOrderHandler} from '../create-order.mjs';

let db;
const product = () => ({id:randomUUID(),itemNumber:999,title:'Synthetic owner Item',slug:'synthetic',status:'AVAILABLE',
  quantityTotal:1,quantityRemaining:1,quantitySold:0,images:['/original.webp'],description:'Original description',askingPricePYG:100,
  saleMode:'IMMEDIATE',depositPercent:100});
const migrations=['20261001_operational_inventory','20261002_cart_extension','20261003_buyer_groups',
  '20261004_order_reservation_events','20261005_pickup_notifications','20261006_notification_recipients',
  '20261009_fulfillment_batches','20261010_pickup_fulfillment_parts','20261113_cart_pricing','20261115_owner_withdrawal'];
test.before(async()=>{
 db=new PGlite();for(const m of migrations)await db.exec(await readFile(new URL(`../../database/migrations/${m}.sql`,import.meta.url),'utf8'));
 setInventoryDatabaseClientForTests({pool:{query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})}});
});
test.after(async()=>{setInventoryDatabaseClientForTests(undefined);await db.close()});
const load = p => loadCatalog('http://localhost',{loadBaseCatalog:async()=>[p],listProductOverrides:async()=>[],readCommittedInventory});
const stock = async p => (await db.query('SELECT * FROM operational_inventory WHERE product_id=$1',[p.id])).rows[0];

test('withdrawal is explicit, idempotent and immutable; quantities, original product and photos survive',async()=>{
 const p=product(),before=structuredClone(p);
 await assert.rejects(withdrawFromSale(p,{confirmed:false}),/Confirmá/);
 await assert.rejects(withdrawFromSale(p,{confirmed:true,actor:'REVIEWER'}),/propietario/);
 const event=await withdrawFromSale(p,{confirmed:true});
 assert.equal(event.actor,'OWNER');assert.equal(event.action,'OWNER_WITHDRAWAL');assert.deepEqual(event.product,before);
 assert.deepEqual(await withdrawFromSale(p,{confirmed:true}),event);assert.deepEqual(p,before);
 assert.equal((await stock(p)).capacity,1);assert.equal((await stock(p)).committed_quantity,0);
 await assert.rejects(db.query('UPDATE operational_inventory SET owner_withdrawal=NULL WHERE product_id=$1',[p.id]),/immutable/);
 await assert.rejects(db.query('DELETE FROM operational_inventory WHERE product_id=$1',[p.id]),/immutable/);
 const [current]=await load(p);assert.equal(current.status,'UNLISTED');assert.equal(current.quantitySold,0);
 assert.equal(current.quantityRemaining,1);assert.deepEqual(current.images,p.images);
 assert.deepEqual(projectPublicCatalog([current],[],p.slug),{products:[],deliveredProduct:null});
 assert.equal((await db.query('SELECT count(*)::int n FROM checkout_attempts')).rows[0].n,0);
});

for(const phase of ['CART','ORDER','COMMITTED']) test(`active ${phase} commitment blocks withdrawal and remains untouched`,async()=>{
 const p=product(),s=randomUUID(),o=randomUUID();
 await db.query('INSERT INTO operational_inventory(product_id,capacity) VALUES($1,1)',[p.id]);
 await db.query('INSERT INTO cart_sessions(session_id) VALUES($1)',[s]);
 if(phase!=='CART')await db.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot)
 VALUES($1,$2,$3,0,'synthetic',$4)`,[o,s,randomUUID(),JSON.stringify({status:'PAYMENT_CONFIRMED',items:[{productId:p.id}],payments:[]})]);
 await db.query(`INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,order_id,expires_at)
 VALUES($1,$2,1,$3,$4,${phase==='CART'?"clock_timestamp()+interval '1 hour'":'NULL'})`,[p.id,s,phase,phase==='CART'?null:o]);
 const before=(await db.query('SELECT * FROM inventory_reservations WHERE product_id=$1',[p.id])).rows;
 await assert.rejects(withdrawFromSale(p,{confirmed:true}),e=>e.status===409&&e.commitments.length>0);
 assert.deepEqual((await db.query('SELECT * FROM inventory_reservations WHERE product_id=$1',[p.id])).rows,before);
 assert.equal((await stock(p)).owner_withdrawal,null);
});

test('an order with missing reservations still blocks withdrawal',async()=>{
 const p=product(),s=randomUUID();await db.query('INSERT INTO cart_sessions(session_id) VALUES($1)',[s]);
 await db.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,committed_at)
 VALUES($1,$2,$3,0,'synthetic',$4,clock_timestamp())`,[randomUUID(),s,randomUUID(),JSON.stringify({status:'PAYMENT_CONFIRMED',items:[{productId:p.id}],payments:[]})]);
 await assert.rejects(withdrawFromSale(p,{confirmed:true}),/compromisos/);
});

test('stale catalog claim is rejected by SQL even if an old page still says AVAILABLE',async()=>{
 const p=product();await withdrawFromSale(p,{confirmed:true});
 await assert.rejects(claimCartLease({cartSessionId:randomUUID(),productId:p.id,quantity:1,availability:1}),/retirado/);
 const cart=createCartReservationHandler({loadProducts:async()=>[p],recordEvent:async()=>{}});
 const response=await cart(new Request('http://localhost/api/cart/reservation',{method:'POST',headers:{'content-type':'application/json',cookie:`psych_cart_session=${randomUUID()}`},body:JSON.stringify({action:'claim',productId:p.id,quantity:1})}));
 assert.equal(response.status,409);assert.equal((await stock(p)).committed_quantity,0);
});

test('expired unpaid order cannot reclaim or confirm a withdrawn Item; unrelated stock stays purchasable',async()=>{
 const p=product(),s=randomUUID(),id=randomUUID(),paymentId=randomUUID();
 const o={id,status:'AWAITING_INITIAL_PAYMENT',payments:[{id:paymentId,type:'PENDING',amountPYG:null,verificationStatus:'PENDING'}],paymentAdjustments:[],
 items:[{productId:p.id,quantity:1,dueNowPYG:100,futureBalancePYG:0}],totals:{totalPYG:100,dueNowPYG:100,futureBalancePYG:0}};
 // An expired payment-bearing order is deliberately held for review.
 await db.query('INSERT INTO operational_inventory(product_id,capacity) VALUES($1,1)',[p.id]);
 await db.query('INSERT INTO cart_sessions(session_id) VALUES($1)',[s]);
 await db.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,expires_at)
 VALUES($1,$2,$3,0,'synthetic',$4,clock_timestamp()-interval '1 hour')`,[id,s,randomUUID(),JSON.stringify(o)]);
 await assert.rejects(withdrawFromSale(p,{confirmed:true}),/compromisos/);
 await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1',[id,JSON.stringify({...o,payments:[]})]);
 await db.query("INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,order_id,expires_at) VALUES($1,$2,1,'ORDER',$3,clock_timestamp()-interval '1 hour')",[p.id,s,id]);
 await withdrawFromSale(p,{confirmed:true});
 await assert.rejects(recordOrderReceipt(id,{fileName:'synthetic'}),/no están disponibles/);
 // A late Admin confirmation also rechecks the locked inventory.
 await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1',[id,JSON.stringify(o)]);
 await assert.rejects(confirmOrderPayment(id,{paymentId,paymentType:'FULL',verifiedAmountPYG:100}),/retirado/);
 const q=product();assert.ok(await claimCartLease({cartSessionId:randomUUID(),productId:q.id,quantity:1,availability:1}));
});

test('withdrawal handler requires authorization and confirmation; direct-link checkout cannot buy unlisted Item',async()=>{
 const p=product();const handler=createWithdrawalHandler({authorized:async()=>false,loadProducts:async()=>{throw Error('must not read')}});
 assert.equal((await handler(new Request('https://isolated.test/api/admin/withdraw-product',{method:'POST'}))).status,401);
 const owner=createWithdrawalHandler({authorized:async()=>true,loadProducts:async()=>[p]});
 const response=await owner(new Request('https://isolated.test/api/admin/withdraw-product',{method:'POST',body:JSON.stringify({productId:p.id,confirmed:true})}));
 assert.equal(response.status,200);assert.match((await response.json()).message,/No se registró una venta/);
 const checkout=createOrderHandler({loadProducts:()=>load(p)});
 const rejected=await checkout(new Request('http://localhost/api/orders/create',{method:'POST',headers:{cookie:`psych_cart_session=${randomUUID()}`},body:JSON.stringify({checkoutId:randomUUID(),buyer:{name:'Synthetic',phone:'000000000'},items:[{productId:p.id,quantity:1}],finalSaleAcknowledged:true,finalSalePolicyVersion:'2026-10-02-v1'})}));
 assert.equal(rejected.status,409);assert.match((await rejected.json()).error,/disponible/);
});
