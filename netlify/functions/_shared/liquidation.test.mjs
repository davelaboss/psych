import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { liquidationPrice, newPurchaseTerms } from './liquidation.mjs';
import campaignState from '../campaign-state.mjs';
import { loadCatalog, loadSaleCatalog, publicOrder } from './commerce.mjs';
import { createOrderHandler } from '../create-order.mjs';
import { createCartReservationHandler } from '../cart-reservation.mjs';
import { claimCartLease, readSalePricingState, getCartLeaseStatus,
  setInventoryDatabaseClientForTests, releaseCartLease } from './inventory-database.mjs';

const product = (n, price = 26301, extra = {}) => ({ id: `item-${n}`, itemNumber: n,
  slug: `item-${n}`, title: `Artículo ${n}`, status: 'AVAILABLE', currency: 'PYG',
  askingPricePYG: price, quantityTotal: 3, quantityRemaining: 3,
  saleMode: 'DELAYED', depositPercent: 25, pickupWindowStart: '2026-12-09',
  pickupWindowEnd: '2026-12-12', ...extra });
const stock = { purchasable_quantity: 3 };

test('public campaign state is read-only, uncached and OFF by default', async () => {
  const previous = process.env.FINAL_LIQUIDATION_ENABLED;
  try {
    delete process.env.FINAL_LIQUIDATION_ENABLED;
    let response = campaignState(new Request('http://localhost/.netlify/functions/campaign-state'));
    assert.deepEqual(await response.json(), {liquidationActive:false});
    assert.equal(response.headers.get('cache-control'),'no-store');
    process.env.FINAL_LIQUIDATION_ENABLED='true';
    response=campaignState(new Request('http://localhost/.netlify/functions/campaign-state'));
    assert.deepEqual(await response.json(), {liquidationActive:true});
    assert.equal(campaignState(new Request('http://localhost/.netlify/functions/campaign-state',{method:'POST'})).status,405);
  } finally {
    if (previous === undefined) delete process.env.FINAL_LIQUIDATION_ENABLED;
    else process.env.FINAL_LIQUIDATION_ENABLED=previous;
  }
});

test('405/441 new purchases use owner-confirmed 25% with campaign ON or OFF; agreements stay intact',async()=>{
  const missingDates={depositPercent:100,pickupAvailableDate:null,pickupWindowStart:null,pickupWindowEnd:null};
  const products=[product(405,38000,missingDates),product(441,50000,missingDates)];
  const before=structuredClone(products);
  for(const enabled of [false,true]) {
    const dependencies={enabled,loadCatalog:async()=>products,
      readSalePricingState:async()=>({inventory:new Map(products.map(p=>[p.id,stock])),cartPrices:new Map()})};
    const sale=await loadSaleCatalog('http://localhost',{},dependencies);
    assert.deepEqual(sale.map(p=>p.depositPercent),[25,25]);
    for (const p of sale) {
      assert.equal(p.pickupWindowStart,'2026-12-09');
      assert.equal(p.pickupWindowEnd,'2026-12-12');
    }
    assert.deepEqual(sale.map(p=>p.askingPricePYG),enabled?[19000,25000]:[38000,50000]);
    const accepted=await loadSaleCatalog('http://localhost',{}, {...dependencies,
      readSalePricingState:async()=>({inventory:new Map(),cartPrices:new Map([
        [products[0].id,null],
        [products[1].id,{askingPricePYG:50000,depositPercent:100,saleMode:'DELAYED'}],
      ])})});
    assert.deepEqual(accepted.map(p=>p.depositPercent),[100,100]);
    assert.deepEqual(accepted.map(p=>p.askingPricePYG),[38000,50000]);
    assert.deepEqual(accepted.map(p=>p.pickupWindowStart),[null,null]);
  }
  const narrow=newPurchaseTerms(product(405,38000,{pickupWindowStart:'2026-12-10',pickupWindowEnd:'2026-12-11'}));
  assert.equal(narrow.pickupWindowStart,'2026-12-10');
  assert.equal(narrow.pickupWindowEnd,'2026-12-11');
  assert.deepEqual(products,before);
});

test('tiers use current asking price before discount, rounded to whole guaranies', () => {
  for (const [original, percent, expected] of [[12000,10,10800],[11999,10,10799],
    [12001,50,6001],[26301,50,13151],[10000,10,9000]]) {
    const p = product(1, original, { originalPricePYG: 999999 });
    const result = liquidationPrice(p, stock, true);
    assert.equal(result.askingPricePYG, expected);
    assert.equal(result.liquidation.percent, percent);
    assert.equal(result.liquidation.originalAskingPricePYG, original);
    assert.equal(p.askingPricePYG, original);
    assert.equal(liquidationPrice(p, stock, false), p);
  }
  assert.equal(liquidationPrice(product(405,38000,{depositPercent:100}),stock,true).depositPercent,25);
});

test('protected Items, inquiry/USD, invalid prices and unsellable stock are untouched', () => {
  for (const p of [product(274,2950000),product(313,1800000),
    product(615,null,{currency:'USD',askingPriceUSD:18000,saleMode:'INQUIRY'}),
    ...['SOLD','PICKED_UP','RESERVED','WITHDRAWN','UNAVAILABLE','UNLISTED','NEEDS_REVIEW'].map(status=>product(1,20000,{status})),
    product(1,20000,{quantityRemaining:0}),product(1,0),product(1,1.5),product(1,NaN)]) {
    assert.equal(liquidationPrice(p, stock, true), p);
  }
  const p = product(1);
  assert.equal(liquidationPrice(p, {purchasable_quantity:0}, true), p);
  assert.equal(liquidationPrice(p, undefined, true), p);
});

test('Admin override wins; authoring/Admin catalog and original objects never get discounted', async () => {
  const base = [product(1,9000),product(274,3800000)];
  const before = structuredClone(base);
  const raw = () => loadCatalog('http://localhost', {
    loadBaseCatalog: async()=>base,
    listProductOverrides: async()=>[
      {productId:'item-1',publicFields:{askingPricePYG:26301}},
      {productId:'item-274',publicFields:{askingPricePYG:2950000}},
    ], readCommittedInventory: async()=>new Map(),
  });
  const sale = await loadSaleCatalog('http://localhost', {}, {loadCatalog:raw, enabled:true,
    readSalePricingState: async()=>({inventory:new Map(base.map(p=>[p.id,stock])),cartPrices:new Map()})});
  assert.equal(sale[0].askingPricePYG,13151);
  assert.equal(sale[1].askingPricePYG,2950000);
  assert.equal((await raw())[0].askingPricePYG,26301);
  assert.deepEqual(base,before);
});

test('real cart-to-checkout flow freezes prices, preserves commitments and old reservations', async () => {
  const db = new PGlite();
  for (const file of ['20261001_operational_inventory','20261002_cart_extension',
    '20261004_order_reservation_events','20261005_pickup_notifications',
    '20261006_notification_recipients']) {
    await db.exec(await readFile(new URL(`../../database/migrations/${file}.sql`, import.meta.url),'utf8'));
  }
  const client = { query:(...args)=>db.query(...args), release(){} };
  setInventoryDatabaseClientForTests({pool:{query:client.query,connect:async()=>client}});
  const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
  let enabled=true;
  let products=[product(1),product(2,11999,{saleMode:'IMMEDIATE',depositPercent:100}),
    product(274,2950000),product(313,1800000),product(615,null,{saleMode:'INQUIRY',currency:'USD',askingPriceUSD:18000})];
  try {
    // An old active cart exists before the additive migration; no price rewrite.
    await claimCartLease({cartSessionId:b,productId:'item-1',quantity:1,availability:3});
    const oldLease=await getCartLeaseStatus(b);
    const oldRows=(await db.query('SELECT * FROM inventory_reservations')).rows;
    await db.exec(await readFile(new URL('../../database/migrations/20261113_cart_pricing.sql',import.meta.url),'utf8'));
    assert.deepEqual((await db.query('SELECT * FROM inventory_reservations')).rows.map(({pricing_snapshot,...r})=>r),oldRows);
    assert.deepEqual(await getCartLeaseStatus(b),oldLease);
    await db.query('INSERT INTO operational_inventory(product_id,capacity,committed_quantity) VALUES ($1,3,1)',['item-2']);
    const loadProducts=(origin,options)=>loadSaleCatalog(origin,options,{
      enabled,loadCatalog:async()=>products,readSalePricingState,
    });
    assert.equal((await loadProducts('http://localhost',{cartSessionId:b}))[0].askingPricePYG,26301);
    const cartHandler=createCartReservationHandler({loadProducts,recordEvent:async()=>{}});
    const claim=async(id,quantity=1)=>{
      const r=await cartHandler(new Request('http://localhost/api/cart/reservation',{
        method:'POST',headers:{cookie:`psych_cart_session=${a}`,'content-type':'application/json'},
        body:JSON.stringify({action:'claim',productId:id,quantity}),
      }));assert.equal(r.status,200);return r.json();
    };
    await claim('item-1',2); await claim('item-2',2);
    let sale=await loadProducts('http://localhost',{cartSessionId:a});
    assert.equal(sale[0].askingPricePYG,13151);
    assert.equal(sale[1].askingPricePYG,10799);
    const held=await readSalePricingState(null);
    assert.equal(Number(held.inventory.get('item-1').purchasable_quantity),0);
    assert.equal(liquidationPrice(products[0],held.inventory.get('item-1'),true),products[0]);
    // Admin changes and campaign reversal affect new shoppers, never held prices.
    products=products.map(p=>p.id==='item-1'?{...p,askingPricePYG:50000}:p);
    enabled=false;
    sale=await loadProducts('http://localhost',{cartSessionId:a});
    assert.equal(sale[0].askingPricePYG,13151);
    assert.deepEqual(await getCartLeaseStatus(b),oldLease);
    const handler=createOrderHandler({loadProducts,readOrder:async()=>null,recoverOrder:async order=>order});
    const checkoutId='33333333-3333-4333-8333-333333333333';
    const request=()=>new Request('http://localhost/api/orders/create',{
      method:'POST',headers:{cookie:`psych_cart_session=${a}`,'content-type':'application/json'},
      body:JSON.stringify({buyer:{name:'Test Buyer',phone:'0981000000'},checkoutId,
        items:[{productId:'item-1',quantity:2},{productId:'item-2',quantity:2}],
        finalSaleAcknowledged:true,finalSalePolicyVersion:'2026-10-02-v1'}),
    });
    const response=await handler(request());
    const result=await response.json();assert.equal(response.status,201,JSON.stringify(result));
    const order=result.order;
    assert.deepEqual(order.totals,{totalPYG:47900,dueNowPYG:28174,futureBalancePYG:19726});
    assert.equal(order.items[0].unitPricePYG,13151);
    assert.equal(order.items[0].depositPercent,25);
    assert.equal(order.items[0].pickupWindowStart,'2026-12-09');
    assert.equal(order.items[0].pickupWindowEnd,'2026-12-12');
    const stored=(await db.query('SELECT order_snapshot FROM checkout_attempts')).rows[0].order_snapshot;
    const retry=await handler(request());assert.deepEqual((await retry.json()).order,order);
    assert.deepEqual((await db.query('SELECT order_snapshot FROM checkout_attempts')).rows[0].order_snapshot,stored);
    assert.equal(publicOrder(stored).items[0].unitPricePYG,13151);
    assert.equal((await db.query("SELECT committed_quantity FROM operational_inventory WHERE product_id='item-2'")).rows[0].committed_quantity,1);
    assert.deepEqual(await getCartLeaseStatus(b),oldLease);
    const protectedSale=await loadProducts('http://localhost',{});
    assert.equal(protectedSale.find(p=>p.itemNumber===274).askingPricePYG,2950000);
    assert.equal(protectedSale.find(p=>p.itemNumber===313).askingPricePYG,1800000);
    assert.equal(protectedSale.find(p=>p.itemNumber===615).askingPriceUSD,18000);
    await releaseCartLease(b);
  } finally { setInventoryDatabaseClientForTests(undefined);await db.close(); }
});
