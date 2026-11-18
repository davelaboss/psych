import { transitionBatch } from './fulfillment-batches.mjs';
import { initializePickupControlForTests } from './test-support/pickup-control.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { itemPaymentEligibility } from './item-payment-eligibility.mjs';
import { appendItemPaymentDecision, readItemPaymentDecisions, requireCollectionPayments } from './item-payment-decisions.mjs';
import { changePickup, pickupFulfillments, listUpcomingPickups } from './pickup.mjs';
import { calendarAppointment } from './pickup-calendar.mjs';
import { setInventoryDatabaseClientForTests } from './inventory-database.mjs';
import { createItemPaymentHandler } from '../admin-item-payment.mjs';
import adminPickup from '../admin-pickup.mjs';
import customerPickup from '../customer-pickup.mjs';
import { hashAccessToken } from './commerce.mjs';

let db;
const migrations = ['20261001_operational_inventory','20261003_buyer_groups','20261005_pickup_notifications',
  '20261006_notification_recipients','20261009_fulfillment_batches','20261010_pickup_fulfillment_parts','20261102_pickup_blackouts'];
const migration = await readFile(new URL('../../database/migrations/20261114_item_payment_pickup.sql', import.meta.url),'utf8');
const payment = (amountPYG, extra = {}) => ({ id:'paid', amountPYG, amountSource:'ADMIN_VERIFIED',
  verifiedBy:'ADMIN', verificationStatus:'CONFIRMED', confirmedAt: 1, ...extra });
const item = (productId = 'a', delayed = false) => ({ productId, itemNumber:productId, quantity:1,
  saleMode:delayed ? 'DELAYED' : 'IMMEDIATE', unitPricePYG:100, dueNowPYG:delayed ? 25 : 100,
  futureBalancePYG:delayed ? 75 : 0, pickupWindowStart:delayed ? '2026-12-09' : null, pickupWindowEnd:delayed ? '2026-12-12' : null });
const order = (items = [item()], payments = [payment(100)]) => ({ id:`VM-SYNTHETIC-${randomUUID()}`,
  status:'PAYMENT_CONFIRMED', items, payments, paymentAdjustments:[], buyer:{name:'Synthetic',phone:'000'},
  totals:{ totalPYG:items.length*100,dueNowPYG:items.reduce((n,i)=>n+i.dueNowPYG,0),futureBalancePYG:items.reduce((n,i)=>n+i.futureBalancePYG,0) } });
const eligibility = (o, events) => itemPaymentEligibility(o,events);
const slot = '2026-11-15|10:00-11:00';
test.before(async () => {
  db = new PGlite();
  for (const name of migrations) await db.exec(await readFile(new URL(`../../database/migrations/${name}.sql`,import.meta.url),'utf8'));
  await db.exec(migration);
  await initializePickupControlForTests(db);
  setInventoryDatabaseClientForTests({pool:{query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})}});
});
test.beforeEach(t => t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-14T12:00:00Z')}));
test.after(async () => { setInventoryDatabaseClientForTests(undefined); await db.close(); });
async function persist(o) {
  const session = randomUUID();
  await db.query('INSERT INTO cart_sessions(session_id) VALUES($1)',[session]);
  await db.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,committed_at)
    VALUES($1,$2,$3,0,'synthetic',$4,clock_timestamp())`,[o.id,session,randomUUID(),JSON.stringify(o)]);
  return o;
}
async function snapshot(o) { return (await db.query('SELECT * FROM checkout_attempts WHERE order_id=$1',[o.id])).rows[0]; }
const allocate = (o, productId, amountPYG, extra={}) => appendItemPaymentDecision(o.id,{
  kind:'ALLOCATE',productId,paymentId:'paid',amountPYG,note:'Synthetic explicit allocation',...extra });
const book = (o, itemIds, extra={}) => changePickup({orderId:o.id,timingKey:'IMMEDIATE',slotKey:slot,actor:'CUSTOMER',itemIds,...extra});
const isolated = { transaction: op => db.transaction(tx=>op(tx)), queueNotifications:async()=>{} };

for (const delayed of [false,true]) for (const amount of [0,10,24,25,99,100]) {
  test(`${delayed?'delayed':'immediate'} threshold at ${amount} confirmed`,()=>{
    const o = order([item('a',delayed)],[payment(amount)]);
    const [e] = eligibility(o);
    assert.equal(e.schedulingEligible,amount >= (delayed?25:100));
    assert.equal(e.handoverEligible,amount>=100);
  });
}
test('receipt, source-less legacy, void and unconfirmed credit do not unlock; verified reconciliation does',()=>{
  for (const p of [payment(100,{verificationStatus:'PENDING'}),payment(100,{amountSource:undefined}),
    payment(100,{verifiedBy:undefined}),payment(100,{voidedAt:2}),payment(100,{amountSource:'LEGACY_OPENING_CREDIT'})]) {
    assert.equal(eligibility(order([item()],[p]))[0].schedulingEligible,false);
  }
  assert.equal(eligibility(order([item()],[payment(100,{amountSource:'LEGACY_RECONCILED'})]))[0].schedulingEligible,true);
});
test('frozen rounded line amounts determine the threshold, independent of catalog and quantity',()=>{
  const o=order([{...item('a',true),quantity:3,unitPricePYG:999999,depositPercent:90,dueNowPYG:26,futureBalancePYG:75}],[payment(26)]);
  assert.equal(eligibility(o)[0].requiredPYG,26);
  assert.equal(eligibility(o)[0].schedulingEligible,true);
  assert.equal(eligibility({...o,items:[{...o.items[0],dueNowPYG:undefined}]})[0].reviewRequired,true);
});
test('partially paid mixed same-time Items remain ineligible until explicitly funded; a paid Item can be booked alone',async()=>{
  const o=await persist(order([item('a'),item('b')],[payment(100)]));
  assert.deepEqual(eligibility(o).map(i=>i.schedulingEligible),[false,false]);
  const before=await snapshot(o);
  const decision=await allocate(o,'a',100);
  const events=await readItemPaymentDecisions(o.id);
  assert.deepEqual(eligibility(o,events).map(i=>i.schedulingEligible),[true,false]);
  await assert.rejects(book(o,['a','b']),/únicamente artículos/);
  await assert.rejects(book(o,undefined),/únicamente artículos/);
  await assert.rejects(book(o,['a','a']),/únicamente artículos/);
  const a=await book(o,['a']);
  assert.deepEqual(a.itemIds,['a']);
  assert.deepEqual(await snapshot(o),before);
  const again=await allocate(o,'a',100,{id:decision.id}); assert.equal(again.id,decision.id);
  await assert.rejects(allocate(o,'b',101),/excede/);
  const upcoming=await listUpcomingPickups({client:db,now:new Date('2026-11-14T12:00:00Z')});
  assert.deepEqual(upcoming.find(a=>a.orderId===o.id).itemNumbers,['a']);
  assert.deepEqual(calendarAppointment({order_snapshot:o,timing_key:'IMMEDIATE',item_ids:['a']}).itemNumbers,['a']);
  await assert.rejects(book(o,['a'],{expectedRevision:0}),/retiro cambió/);
  assert.equal((await book(o,['a'],{expectedRevision:1})).revision,1);
});
test('allocation reversal appends audit history, releases funds, and never alters existing appointments',async()=>{
  const o=await persist(order([item('a'),item('b')],[payment(100)]));
  const allocated=await allocate(o,'a',100);
  await book(o,['a']);
  const appointments=(await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[o.id])).rows;
  await assert.rejects(allocate(o,'b',1),/excede/);
  const id=randomUUID();
  const reverse={id,kind:'REVERSE',reversesId:allocated.id,note:'Synthetic correction'};
  await appendItemPaymentDecision(o.id,reverse); await appendItemPaymentDecision(o.id,reverse);
  assert.equal((await readItemPaymentDecisions(o.id)).length,2);
  assert.equal(eligibility(o,await readItemPaymentDecisions(o.id))[0].schedulingEligible,false);
  await assert.rejects(book(o,['a']),/Admin debe confirmar/);
  await allocate(o,'b',100);
  assert.deepEqual((await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[o.id])).rows,appointments);
  for (const sql of ['UPDATE item_payment_decisions SET note=note','DELETE FROM item_payment_decisions','TRUNCATE item_payment_decisions']) {
    await assert.rejects(db.exec(sql),/append-only/);
  }
});
test('an Item-specific exception preserves an agreed deposit without interpreting old notes',async()=>{
  const o=await persist({...order([item('a',true)],[payment(10)]),paymentNotes:[{kind:'EXCEPTION',text:'10% agreed'}]});
  assert.equal(eligibility(o)[0].schedulingEligible,false);
  const before=await snapshot(o);
  const decision=await appendItemPaymentDecision(o.id,{kind:'REQUIREMENT',productId:'a',schedulingRequiredPYG:10,
    collectionRequiredPYG:100,note:'Explicit Item agreement reference'});
  const [e]=eligibility(o,await readItemPaymentDecisions(o.id));
  assert.equal(e.schedulingEligible,true); assert.equal(e.handoverEligible,false);
  await appendItemPaymentDecision(o.id,{kind:'REVOKE',reversesId:decision.id,note:'Synthetic revocation'});
  assert.equal(eligibility(o,await readItemPaymentDecisions(o.id))[0].schedulingEligible,false);
  assert.deepEqual(await snapshot(o),before);
});
test('gift and approved credit require explicit decisions and cannot be allocated twice',async()=>{
  const o=await persist(order([item('a'),item('b')],[payment(100,{amountSource:'LEGACY_OPENING_CREDIT'})]));
  await allocate(o,'a',100);
  await assert.rejects(allocate(o,'b',1),/excede/);
  await appendItemPaymentDecision(o.id,{kind:'REQUIREMENT',productId:'b',schedulingRequiredPYG:0,collectionRequiredPYG:0,note:'Explicit gift approval'});
  assert.deepEqual(eligibility(o,await readItemPaymentDecisions(o.id)).map(i=>i.schedulingEligible),[true,true]);
});
test('known single-Item post-sale refunds preserve net and agreed obligation; ambiguous mixed refunds require review',()=>{
  const o={...order(),paymentAdjustments:[{kind:'POST_SALE_PRICE_ADJUSTMENT',amountPYG:30}]};
  const [e]=eligibility(o); assert.equal(e.fundedPYG,70); assert.equal(e.requiredPYG,70); assert.equal(e.schedulingEligible,true);
  assert.equal(eligibility({...o,items:[item('a'),item('b')]})[0].reviewRequired,true);
  assert.equal(eligibility({...o,paymentAdjustments:[{kind:'UNKNOWN_REFUND',amountPYG:30}]})[0].reviewRequired,true);
  assert.equal(eligibility({...o,paymentAdjustments:[{kind:'POST_SALE_PRICE_ADJUSTMENT',amountPYG:101}]})[0].reviewRequired,true);
});
test('confirmation after an audit snapshot is recognized by current SQL without altering any appointment',async()=>{
  const stale=await persist(order([item('373')],[payment(0,{verificationStatus:'PENDING',amountPYG:null})]));
  assert.equal(eligibility(stale)[0].schedulingEligible,false);
  const confirmed={...stale,payments:[payment(100)]};
  await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1',[stale.id,JSON.stringify(confirmed)]);
  const parts=await pickupFulfillments(stale);
  assert.equal(parts[0].schedulingEligible,true);
  await changePickup({orderId:stale.id,timingKey:'IMMEDIATE',slotKey:slot,actor:'CUSTOMER'},isolated);
  assert.equal((await readItemPaymentDecisions(stale.id)).length,0);
});
test('current SQL void blocks a stale paid request and preserves its original appointment',async()=>{
  const o=await persist(order());
  await changePickup({orderId:o.id,timingKey:'IMMEDIATE',slotKey:slot,actor:'ADMIN'},isolated);
  const before=(await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[o.id])).rows;
  await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1',[o.id,JSON.stringify({...o,payments:[payment(100,{voidedAt:2})]})]);
  for (const actor of ['ADMIN','CUSTOMER']) await assert.rejects(changePickup({orderId:o.id,timingKey:'IMMEDIATE',slotKey:slot,actor},isolated),/Admin debe confirmar/);
  assert.deepEqual((await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[o.id])).rows,before);
});
test('unauthorized Admin ledger and pickup requests fail before any database action',async()=>{
  const request=new Request('https://isolated.test/api/admin/item-payment',{method:'POST',body:'{}'});
  let writes=0;
  const handler=createItemPaymentHandler({authorized:()=>false,append:()=>{writes++;}});
  assert.equal((await handler(request)).status,401); assert.equal(writes,0);
  assert.equal((await adminPickup(new Request('https://isolated.test/api/admin/pickup',{method:'POST',body:'{}'}))).status,401);
  await assert.rejects(changePickup({actor:'REVIEWER'}),/no autorizado/);
});
test('migration preserves populated snapshots and appointments byte-for-byte including restored revision 3',async()=>{
  const legacy=new PGlite();
  try {
    for (const name of migrations) await legacy.exec(await readFile(new URL(`../../database/migrations/${name}.sql`,import.meta.url),'utf8'));
    const o=order([item('546')],[payment(9000)]),session=randomUUID();
    await legacy.query('INSERT INTO cart_sessions(session_id) VALUES($1)',[session]);
    await legacy.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot)
      VALUES($1,$2,$3,0,'synthetic',$4)`,[o.id,session,randomUUID(),JSON.stringify(o)]);
    await legacy.query('INSERT INTO pickup_windows(slot_key) VALUES($1)',[slot]);
    await legacy.query(`INSERT INTO pickup_appointments(order_id,timing_key,slot_key,status,changed_by,revision)
      VALUES($1,'IMMEDIATE',$2,'SCHEDULED','ADMIN',3)`,[o.id,slot]);
    const before=(await legacy.query('SELECT * FROM pickup_appointments')).rows;
    const beforeOrder=(await legacy.query('SELECT * FROM checkout_attempts')).rows;
    await legacy.exec(migration);
    const after=(await legacy.query('SELECT * FROM pickup_appointments')).rows.map(({item_ids,...a})=>{assert.equal(item_ids,null);return a;});
    assert.deepEqual(after,before);
    assert.deepEqual((await legacy.query('SELECT * FROM checkout_attempts')).rows,beforeOrder);
    assert.deepEqual((await legacy.query('SELECT * FROM item_payment_decisions')).rows,[]);
  } finally {await legacy.close();}
});
test('direct customer API requests require the private credential and cannot bypass payment eligibility',async()=>{
  const o=await persist({...order([item('private')],[payment(0,{verificationStatus:'PENDING',amountPYG:null})]),
    accessTokenHash:hashAccessToken('synthetic-private-token')});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('External services prohibited in isolated tests');};
  try {
    for(const access of ['wrong','synthetic-private-token']) {
      const request=new Request('https://isolated.test/.netlify/functions/customer-pickup',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderId:o.id,access,timingKey:'IMMEDIATE',slotKey:slot,itemIds:['private']})});
      const response=await customerPickup(request);
      assert.equal(response.status,access==='wrong'?404:409);
      assert.match(response.headers.get('cache-control'),/no-store/);
    }
    assert.equal((await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[o.id])).rows.length,0);
  } finally {globalThis.fetch=originalFetch;}
});
test('voiding an allocated payment never blocks an independently funded sibling Item',async()=>{
  const o=await persist(order([item('a'),item('b')],[payment(100),payment(100,{id:'second'})]));
  await allocate(o,'a',100);
  await allocate(o,'b',100,{paymentId:'second'});
  const changed={...o,payments:[payment(100,{voidedAt:2}),payment(100,{id:'second'})]};
  assert.deepEqual(eligibility(changed,await readItemPaymentDecisions(o.id)).map(i=>i.schedulingEligible),[false,true]);
});
test('a delayed Item deposit permits scheduling but current collection requires its full agreed payment',async()=>{
  const o=await persist(order([item('delayed',true)],[payment(25)]));
  const items=[{orderId:o.id,productId:'delayed'}];
  await assert.rejects(requireCollectionPayments(db,items),/Antes de entregar/);
  await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1',[o.id,JSON.stringify({...o,payments:[payment(100)]})]);
  await requireCollectionPayments(db,items);
});


for (const delayed of [false,true]) test(`fully paid ${delayed?'mixed immediate/delayed':'same-time multi-Item'} order schedules and records delivery without allocations`,async()=>{
  const o=await persist(order([item('full-a'),item('full-b',delayed)],[payment(75),payment(125,{id:'second',amountSource:'LEGACY_RECONCILED'})]));
  const before=await snapshot(o);
  const parts=await pickupFulfillments(o);
  assert.ok(parts.every(p=>p.schedulingEligible&&p.handoverEligible));
  assert.ok(parts.flatMap(p=>p.itemEligibility).every(e=>e.fundingSource==='FULL_ORDER'));
  for(const part of parts){
    const key=part.timingKey==='IMMEDIATE'?'2026-11-20|08:00-09:00':'2026-12-09|08:00-09:00';
    await changePickup({orderId:o.id,timingKey:part.timingKey,slotKey:key,actor:'CUSTOMER',itemIds:part.itemIds,expectedRevision:0},{...isolated,slotKeys:()=>[key]});
  }
  const appointments=(await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1 ORDER BY timing_key',[o.id])).rows;
  const group=randomUUID(),batch=randomUUID();
  await db.query("INSERT INTO buyer_groups(buyer_group_id,display_name) VALUES($1,'Synthetic buyer')",[group]);
  await db.query("INSERT INTO fulfillment_batches(fulfillment_batch_id,buyer_group_id,timing_key,status,auto_attach) VALUES($1,$2,'IMMEDIATE','PREPARED',false)",[batch,group]);
  for(const i of o.items)await db.query("INSERT INTO fulfillment_batch_items(order_id,product_id,fulfillment_batch_id,assignment_mode) VALUES($1,$2,$3,'MANUAL_COMBINE')",[o.id,i.productId,batch]);
  await pickupFulfillments(o);
  assert.equal((await db.query('SELECT status FROM fulfillment_batches WHERE fulfillment_batch_id=$1',[batch])).rows[0].status,'PREPARED');
  await db.transaction(tx=>transitionBatch(tx,{batchId:batch,action:'DELIVER',expectedRevision:1}));
  assert.equal((await db.query('SELECT status FROM fulfillment_batches WHERE fulfillment_batch_id=$1',[batch])).rows[0].status,'DELIVERED');
  assert.equal((await db.query('SELECT * FROM fulfillment_batch_events WHERE fulfillment_batch_id=$1',[batch])).rows.length,1);
  assert.deepEqual(await snapshot(o),before);
  assert.deepEqual((await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1 ORDER BY timing_key',[o.id])).rows,appointments);
  assert.deepEqual(await readItemPaymentDecisions(o.id),[]);
});

test('existing allocations and reversals do not obstruct independently confirmed full-order coverage',async()=>{
  const o=await persist(order([item('alloc-a'),item('alloc-b')],[payment(200)]));
  const event=await allocate(o,'alloc-a',150);
  const financial=await snapshot(o),ledger=await readItemPaymentDecisions(o.id);
  assert.ok(eligibility(o,ledger).every(e=>e.schedulingEligible&&e.handoverEligible&&e.fundingSource==='FULL_ORDER'));
  await requireCollectionPayments(db,o.items.map(i=>({orderId:o.id,productId:i.productId})));
  await assert.rejects(allocate(o,'alloc-b',51),/excede/);
  assert.deepEqual(await readItemPaymentDecisions(o.id),ledger);
  await appendItemPaymentDecision(o.id,{kind:'REVERSE',reversesId:event.id,note:'Synthetic reversal; cash remains confirmed'});
  assert.ok(eligibility(o,await readItemPaymentDecisions(o.id)).every(e=>e.schedulingEligible&&e.handoverEligible));
  assert.deepEqual(await snapshot(o),financial);
});

test('full confirmed order preserves explicit Item requirements, including a higher collection obligation',()=>{
  const o=order([item('a'),item('b')],[payment(200)]);
  const exception={id:randomUUID(),kind:'REQUIREMENT',product_id:'a',scheduling_required_pyg:50,collection_required_pyg:150};
  assert.equal(eligibility(o,[exception])[0].handoverEligible,false);
  const approved=eligibility({...o,payments:[payment(250)]},[exception]);
  assert.ok(approved.every(e=>e.schedulingEligible&&e.handoverEligible));
  assert.equal(approved[0].source,'ADMIN_EXCEPTION');assert.equal(approved[0].requiredPYG,50);assert.equal(approved[0].collectionRequiredPYG,150);
  const gift={...exception,scheduling_required_pyg:0,collection_required_pyg:0};
  assert.equal(eligibility({...o,payments:[payment(100)]},[gift])[1].schedulingEligible,false);
});

for(const [label,make] of [
  ['partial funds despite paid status and zero displayed balance',o=>({...o,payments:[payment(199)],status:'PAID_IN_FULL',remainingBalancePYG:0,paymentState:'FULLY_PAID'})],
  ['receipt without confirmation',o=>({...o,payments:[payment(200,{verificationStatus:'PENDING'})]})],
  ['assumed historical payment',o=>({...o,payments:[payment(200,{amountSource:'LEGACY_ASSUMED'})]})],
  ['approved credit without explicit allocation',o=>({...o,payments:[payment(200,{amountSource:'LEGACY_OPENING_CREDIT'})]})],
  ['missing Admin verification',o=>({...o,payments:[payment(200,{verifiedBy:undefined})]})],
  ['voided payment',o=>({...o,payments:[payment(200,{voidedAt:2})]})],
  ['duplicate payment identifiers',o=>({...o,payments:[payment(100),payment(100)]})],
  ['inconsistent frozen total',o=>({...o,totals:{...o.totals,totalPYG:100}})],
  ['inconsistent frozen due-now amount',o=>({...o,totals:{...o.totals,dueNowPYG:0}})],
  ['unattributed mixed-order refund',o=>({...o,paymentAdjustments:[{kind:'POST_SALE_PRICE_ADJUSTMENT',amountPYG:10}]})],
  ['unsupported adjustment',o=>({...o,paymentAdjustments:[{kind:'UNKNOWN_CREDIT',amountPYG:10}]})],
])test(`ambiguous or insufficient full-order evidence stays closed: ${label}`,()=>{
  const o=make(order([item('a'),item('b')],[payment(200)]));
  assert.ok(eligibility(o).every(e=>!e.schedulingEligible&&!e.handoverEligible&&e.fundingSource!=='FULL_ORDER'));
});

test('explicit allocation from an approved credit still works for a partially cash-funded order',async()=>{
  const o=await persist(order([item('credit-a'),item('credit-b')],[payment(100),payment(100,{id:'credit',amountSource:'LEGACY_OPENING_CREDIT'})]));
  assert.ok(eligibility(o).every(e=>!e.schedulingEligible));
  await allocate(o,'credit-a',100,{paymentId:'credit'});
  assert.deepEqual(eligibility(o,await readItemPaymentDecisions(o.id)).map(e=>e.schedulingEligible),[true,false]);
});

test('late final confirmation unlocks a mixed order from current SQL; a later void closes new operations without touching its appointment',async()=>{
  const o=await persist(order([item('late-a'),item('late-b',true)],[payment(125)]));
  const before=await snapshot(o);assert.ok(eligibility(o).every(e=>!e.schedulingEligible));
  const paid={...o,payments:[payment(125),payment(75,{id:'final'})]};
  await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1',[o.id,JSON.stringify(paid)]);
  const parts=await pickupFulfillments(o);assert.ok(parts.every(p=>p.schedulingEligible&&p.handoverEligible));
  const key='2026-11-19|08:00-09:00';
  await changePickup({orderId:o.id,timingKey:'IMMEDIATE',slotKey:key,actor:'ADMIN',itemIds:['late-a']},{...isolated,slotKeys:()=>[key]});
  const appointments=(await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[o.id])).rows;
  const voided={...paid,payments:paid.payments.map(p=>p.id==='final'?{...p,voidedAt:2}:p)};
  await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1',[o.id,JSON.stringify(voided)]);
  await assert.rejects(requireCollectionPayments(db,o.items.map(i=>({orderId:o.id,productId:i.productId}))),/Antes de entregar/);
  await assert.rejects(changePickup({orderId:o.id,timingKey:'IMMEDIATE',slotKey:key,actor:'CUSTOMER',itemIds:['late-a']},isolated),/Admin debe confirmar/);
  assert.deepEqual((await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[o.id])).rows,appointments);
  assert.deepEqual(await readItemPaymentDecisions(o.id),[]);
  assert.deepEqual((await snapshot(o)).order_snapshot.totals,before.order_snapshot.totals);
});


test('a fully paid single Item with a prior partial allocation needs no allocation top-up',async()=>{
  const o=await persist(order([item('single-full')],[payment(100)]));
  await allocate(o,'single-full',25);const ledger=await readItemPaymentDecisions(o.id),before=await snapshot(o);
  assert.equal(eligibility(o,ledger)[0].fundingSource,'FULL_ORDER');
  await requireCollectionPayments(db,[{orderId:o.id,productId:'single-full'}]);
  assert.deepEqual(await readItemPaymentDecisions(o.id),ledger);assert.deepEqual(await snapshot(o),before);
});

test('additional pending receipt does not dilute independently verified full-order funds',()=>{
  const o=order([item('a'),item('b')],[payment(225),payment(null,{id:'receipt',verificationStatus:'PENDING',amountSource:undefined})]);
  assert.ok(eligibility(o).every(e=>e.fundingSource==='FULL_ORDER'&&e.schedulingEligible&&e.handoverEligible));
});
