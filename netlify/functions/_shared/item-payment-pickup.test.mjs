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
const migrations = ['20261001_operational_inventory','20261005_pickup_notifications',
  '20261006_notification_recipients','20261010_pickup_fulfillment_parts','20261102_pickup_blackouts'];
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
test('mixed same-time Items remain ineligible until explicitly funded; a paid Item can be booked alone',async()=>{
  const o=await persist(order([item('a'),item('b')],[payment(200)]));
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
