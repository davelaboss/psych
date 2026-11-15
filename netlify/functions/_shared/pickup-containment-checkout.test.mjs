import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createCartReservationHandler} from '../cart-reservation.mjs';
import {createOrderHandler} from '../create-order.mjs';
import customerPickup from '../customer-pickup.mjs';
import {pickupFulfillments} from './pickup.mjs';
import {setInventoryDatabaseClientForTests,readSalePricingState} from './inventory-database.mjs';
import {withCartPricing} from './liquidation.mjs';

for(const delayed of [false,true])test(`${delayed?'delayed':'immediate'} available Item -> reserved cart -> checkout order -> checkout stays available while pickup containment is paused`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-14T12:00:00Z')});
  const db=new PGlite();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('No external services allowed in isolated checkout verification');};
  try{
    for(const name of ['20261001_operational_inventory','20261002_cart_extension','20261004_order_reservation_events','20261005_pickup_notifications',
      '20261006_notification_recipients','20261010_pickup_fulfillment_parts','20261102_pickup_blackouts','20261113_cart_pricing','20261114_item_payment_pickup','20261115_pickup_containment']){
      await db.exec(await readFile(new URL(`../../database/migrations/${name}.sql`,import.meta.url),'utf8'));
    }
    const query=(...args)=>db.query(...args);
    setInventoryDatabaseClientForTests({pool:{query,connect:async()=>({query,release(){}})}});
    const cartSessionId=randomUUID(),checkoutId=randomUUID(),productId=`isolated-checkout-${delayed?'delayed':'immediate'}`;
    const price=delayed?26301:13700,quantity=2;
    let product={id:productId,itemNumber:delayed?900002:900001,slug:productId,title:'Isolated integration Item',
      status:'AVAILABLE',currency:'PYG',quantityRemaining:3,quantityTotal:3,askingPricePYG:price,
      saleMode:delayed?'DELAYED':'IMMEDIATE',depositPercent:delayed?25:100,
      pickupWindowStart:delayed?'2026-12-09':null,pickupWindowEnd:delayed?'2026-12-12':null};
    // Use the same frozen cart-price projection consumed by the live loader.
    const loadProducts=async(_origin,{cartSessionId:session}={})=>{
      const state=await readSalePricingState(session);
      return [state.cartPrices.has(productId)?withCartPricing(product,state.cartPrices.get(productId)):product];
    };
    const headers={cookie:`psych_cart_session=${cartSessionId}`,'content-type':'application/json'};
    const cart=createCartReservationHandler({loadProducts,recordEvent:async()=>{}});
    const claim=await cart(new Request('https://isolated.test/api/cart/reservation',{method:'POST',headers,
      body:JSON.stringify({action:'claim',productId,quantity})}));
    assert.equal(claim.status,200);assert.equal((await claim.json()).ok,true);
    const held=(await query('SELECT * FROM inventory_reservations')).rows[0];
    assert.equal(held.phase,'CART');assert.equal(held.quantity,quantity);assert.equal(held.pricing_snapshot.askingPricePYG,price);
    const cartRead=await cart(new Request('https://isolated.test/api/cart/reservation',{headers}));
    assert.equal(cartRead.status,200);assert.equal((await cartRead.json()).lease.items[productId],quantity);
    product={...product,askingPricePYG:49999};
    const createOrder=createOrderHandler({loadProducts,readOrder:async()=>null,recoverOrder:async order=>order});
    const checkout=await createOrder(new Request('https://isolated.test/api/orders/create',{method:'POST',headers,body:JSON.stringify({
      buyer:{name:'Isolated integration buyer',phone:'00000000'},checkoutId,items:[{productId,quantity}],
      finalSaleAcknowledged:true,finalSalePolicyVersion:'2026-10-02-v1'})}));
    const result=await checkout.json();assert.equal(checkout.status,201,JSON.stringify(result));
    const total=price*quantity,dueNow=(delayed?Math.round(price*0.25):price)*quantity;
    assert.deepEqual(result.order.totals,{totalPYG:total,dueNowPYG:dueNow,futureBalancePYG:total-dueNow});
    assert.equal(result.order.items[0].unitPricePYG,price);assert.equal(result.order.remainingBalancePYG,total);
    assert.equal(result.order.status,'AWAITING_INITIAL_PAYMENT');assert.equal(result.order.reservationState,'ACTIVE');
    assert.equal(result.order.paidAmountPYG,0);assert.deepEqual(result.order.payments,[]);
    const row=(await query('SELECT * FROM checkout_attempts')).rows[0];
    assert.equal(row.committed_at,null);assert.ok(new Date(row.expires_at).getTime()>Date.now());
    const reservation=(await query('SELECT * FROM inventory_reservations')).rows[0];
    assert.equal(reservation.phase,'ORDER');assert.equal(reservation.order_id,result.order.id);
    assert.equal(reservation.quantity,quantity);assert.equal(reservation.pricing_snapshot.askingPricePYG,price);
    assert.equal((await query('SELECT committed_quantity FROM operational_inventory')).rows[0].committed_quantity,0);
    const emptyCart=await cart(new Request('https://isolated.test/api/cart/reservation',{headers}));
    const cartAfter=await emptyCart.json();assert.equal(cartAfter.lease,null);
    const snapshot=async()=>({
      orders:(await query('SELECT * FROM checkout_attempts')).rows,
      reservations:(await query('SELECT * FROM inventory_reservations')).rows,
      inventory:(await query('SELECT * FROM operational_inventory')).rows,
      appointments:(await query('SELECT * FROM pickup_appointments')).rows,
      ledger:(await query('SELECT * FROM item_payment_decisions')).rows,
      notifications:(await query('SELECT * FROM seller_notifications')).rows,
    });
    const before=await snapshot();
    const [part]=await pickupFulfillments(row.order_snapshot);
    assert.equal(part.schedulingEligible,false);assert.deepEqual(part.slots,[]);assert.equal(part.appointment,null);
    const pickupResponse=await customerPickup(new Request('https://isolated.test/.netlify/functions/customer-pickup',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({orderId:result.order.id,access:result.accessToken,timingKey:part.timingKey,
        itemIds:[productId],slotKey:delayed?'2026-12-09|08:00-09:00':'2026-11-15|10:00-11:00',expectedRevision:0})}));
    assert.equal(pickupResponse.status,503);assert.match((await pickupResponse.json()).error,/pausados/);
    assert.equal(part.writesPaused,true);
    assert.deepEqual(await snapshot(),before);
  }finally{setInventoryDatabaseClientForTests(undefined);globalThis.fetch=originalFetch;await db.close();}
});