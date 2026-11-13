import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {loadSaleCatalog} from './commerce.mjs';
import {cartPricingSnapshot} from './liquidation.mjs';
import {createCartReservationHandler} from '../cart-reservation.mjs';
import {createOrderHandler} from '../create-order.mjs';
import {claimCartLease,readSalePricingState,setInventoryDatabaseClientForTests,getCartLeaseStatus} from './inventory-database.mjs';

test('first claims without inventory rows advertise, freeze and charge both approved tiers; held and accepted prices stay protected',async()=>{
  const db=new PGlite();
  for(const file of ['20261001_operational_inventory','20261002_cart_extension','20261004_order_reservation_events',
    '20261005_pickup_notifications','20261006_notification_recipients','20261113_cart_pricing']) {
    await db.exec(await readFile(new URL(`../../database/migrations/${file}.sql`,import.meta.url),'utf8'));
  }
  const client={query:(...args)=>db.query(...args),release(){}};
  setInventoryDatabaseClientForTests({pool:{query:client.query,connect:async()=>client}});
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  const product=(n,price,fields={})=>({id:`item-${n}`,itemNumber:n,slug:`item-${n}`,title:`Artículo ${n}`,
    askingPricePYG:price,status:'AVAILABLE',currency:'PYG',saleMode:'IMMEDIATE',depositPercent:100,
    quantityRemaining:1,quantityTotal:1,...fields});
  // Production examples 658/662/038 have no operational rows. The small-tier
  // case deliberately has none either, unlike the old pre-seeded browser fixture.
  let products=[product(658,30000),product(662,30000),product(38,25000),
    product(526,12000,{saleMode:'DELAYED',depositPercent:25,pickupWindowStart:'2026-12-09',pickupWindowEnd:'2026-12-12'}),
    product(464,26000),product(447,55000,{quantityRemaining:2,quantityTotal:2})];
  let enabled=true;
  const loadProducts=(origin,options)=>loadSaleCatalog(origin,options,{enabled,loadCatalog:async()=>products,readSalePricingState});
  try{
    // Reproduce 464's current full hold at the correct agreed discount, plus a
    // pre-fix accepted full-price snapshot. Neither may be rewritten by this fix.
    await claimCartLease({cartSessionId:b,productId:'item-464',quantity:1,availability:1,
      pricingSnapshot:cartPricingSnapshot({...products[4],askingPricePYG:13000})});
    await claimCartLease({cartSessionId:b,productId:'item-447',quantity:1,availability:2,
      pricingSnapshot:cartPricingSnapshot(products[5])});
    const acceptedBefore=await getCartLeaseStatus(b);
    const storedBefore=(await db.query('SELECT * FROM inventory_reservations WHERE session_id=$1 ORDER BY product_id',[b])).rows;
    assert.equal((await db.query('SELECT count(*)::int AS n FROM operational_inventory')).rows[0].n,2);
    let sale=await loadProducts('http://localhost',{});
    assert.deepEqual(sale.slice(0,4).map(p=>p.askingPricePYG),[15000,15000,12500,10800]);
    assert.equal(sale[4].liquidation,undefined); // fully held, not discounted for a new buyer
    const cart=createCartReservationHandler({loadProducts,recordEvent:async()=>{}});
    const claim=async id=>cart(new Request('http://localhost/api/cart/reservation',{method:'POST',
      headers:{cookie:`psych_cart_session=${a}`,'content-type':'application/json'},
      body:JSON.stringify({action:'claim',productId:id,quantity:1})}));
    assert.equal((await claim('item-464')).status,409);
    for(const p of products.slice(0,4))assert.equal((await claim(p.id)).status,200);
    sale=await loadProducts('http://localhost',{cartSessionId:a});
    assert.deepEqual(sale.slice(0,4).map(p=>p.askingPricePYG),[15000,15000,12500,10800]);
    const snapshots=(await db.query('SELECT pricing_snapshot FROM inventory_reservations WHERE session_id=$1 ORDER BY product_id',[a])).rows;
    assert.ok(snapshots.every(r=>r.pricing_snapshot.liquidation));
    enabled=false;products=products.map(p=>p.itemNumber===658?{...p,askingPricePYG:40000}:p);
    const orders=createOrderHandler({loadProducts,readOrder:async()=>null,recoverOrder:async o=>o});
    const request=()=>new Request('http://localhost/api/orders/create',{method:'POST',
      headers:{cookie:`psych_cart_session=${a}`,'content-type':'application/json'},body:JSON.stringify({
        buyer:{name:'Test local',phone:'00000000'},checkoutId:'33333333-3333-4333-8333-333333333333',
        items:products.slice(0,4).map(p=>({productId:p.id,quantity:1})),
        finalSaleAcknowledged:true,finalSalePolicyVersion:'2026-10-02-v1'})});
    const response=await orders(request());assert.equal(response.status,201);
    const order=(await response.json()).order;
    assert.deepEqual(order.totals,{totalPYG:53300,dueNowPYG:45200,futureBalancePYG:8100});
    assert.deepEqual(order.items.map(p=>p.unitPricePYG).sort((a,b)=>a-b),[10800,12500,15000,15000]);
    assert.deepEqual((await(await orders(request())).json()).order,order);
    assert.deepEqual(await getCartLeaseStatus(b),acceptedBefore);
    assert.deepEqual((await db.query('SELECT * FROM inventory_reservations WHERE session_id=$1 ORDER BY product_id',[b])).rows,storedBefore);
    const prior=await loadProducts('http://localhost',{cartSessionId:b});
    assert.equal(prior.find(p=>p.itemNumber===447).askingPricePYG,55000);
    assert.equal(prior.find(p=>p.itemNumber===464).askingPricePYG,13000);
  }finally{setInventoryDatabaseClientForTests(undefined);await db.close()}
});
