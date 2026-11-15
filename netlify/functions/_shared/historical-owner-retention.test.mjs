import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {migrateRetentionFixture,seedRetentionFixture} from './test-support/historical-retention-fixture.mjs';
import {readOwnerRetentionPlan,validateOwnerRetentionPlan,applyHistoricalOwnerRetention} from './historical-owner-retention.mjs';
import {RETENTION_ORDER,RETENTION_BATCH,RETENTION_ITEMS,RETENTION_SIBLING_ORDER,CLOSED_OWNER_RETENTION} from './owner-retention-core.mjs';
import {setInventoryDatabaseClientForTests,readCommittedInventory,readSalePricingState,recordOrderPostSalePriceAdjustment,recordOrderReceipt,confirmOrderPayment,claimCartLease,synchronizeOrderProjection} from './inventory-database.mjs';
import {loadCatalog,loadSaleCatalog,projectPublicCatalog,publicOrder} from './commerce.mjs';
import {itemPaymentEligibility} from './item-payment-eligibility.mjs';
import {deriveOrderFulfillmentParts,orderSchedulingEligible} from './order-fulfillments.mjs';
import {ensureFulfillmentAssignments,transitionBatch,combineBatches,separateItems,listFulfillmentBatches} from './fulfillment-batches.mjs';
import {appendItemPaymentDecision} from './item-payment-decisions.mjs';
import {changePickup} from './pickup.mjs';
import {loadSalePulseSnapshot} from '../admin-sale-pulse.mjs';

let db,fixture,plan,before,pricesBefore;
const products=()=>loadCatalog('http://localhost',{loadBaseCatalog:async()=>fixture.products,listProductOverrides:async()=>[],readCommittedInventory});
const prices=async()=>(await loadSaleCatalog('http://localhost',{}, {enabled:true,loadCatalog:products,readSalePricingState})).map(p=>({id:p.id,askingPricePYG:p.askingPricePYG,depositPercent:p.depositPercent,liquidation:p.liquidation||null}));
const tables=['checkout_attempts','operational_inventory','inventory_reservations','fulfillment_batches','fulfillment_batch_items','fulfillment_batch_events','pickup_appointments','item_payment_decisions','pickup_write_control','pickup_write_control_events','buyer_group_orders','buyer_groups'];
const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.query(`SELECT to_jsonb(r) row FROM ${t} r ORDER BY to_jsonb(r)::text`)).rows.map(r=>r.row)])));
const input=()=>({expectedFingerprint:plan.fingerprint,approvalReference:'ISOLATED OWNER APPROVAL — NOT PRODUCTION'});
test.before(async()=>{
 db=new PGlite();setInventoryDatabaseClientForTests({pool:{query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})}});
 await migrateRetentionFixture(db,{correction:false});fixture=await seedRetentionFixture(db);before=await snapshot();
 await db.exec(await readFile(new URL('../../database/migrations/20261118_historical_owner_retention.sql',import.meta.url),'utf8'));
 assert.deepEqual(await snapshot(),before,'migration must not perform the correction or change populated records');
 plan=await readOwnerRetentionPlan(db);
 pricesBefore=await prices();
});
test.after(async()=>{setInventoryDatabaseClientForTests(undefined);await db.close()});

test('read-only plan identifies exactly four retained units and the separate 466 commitment',()=>{
 assert.deepEqual(validateOwnerRetentionPlan(plan),{alreadyApplied:false});assert.match(plan.fingerprint,/^[a-f0-9]{64}$/);
 assert.equal(plan.state.otherOrders[0].order_id,RETENTION_SIBLING_ORDER);
 assert.equal(plan.state.inventory.find(i=>i.productId===RETENTION_ITEMS[3].productId).capacity,3);
});
for(const [label,change] of [
 ['foreign Item',s=>s.order.order_snapshot.items[0].productId='unrelated'],
 ['quantity',s=>s.order.order_snapshot.items[3].quantity=2],
 ['agreed line terms',s=>s.order.order_snapshot.items[0].unitPricePYG=1],
 ['payment',s=>s.order.order_snapshot.payments[0].amountPYG=1],
 ['adjustment',s=>s.order.order_snapshot.paymentAdjustments[0].id='other'],
 ['batch revision',s=>s.batch.revision=3],
 ['delivered batch',s=>s.batch.delivered_at='2026-11-15'],
 ['foreign membership',s=>s.memberships[0].order_id='other-customer'],
 ['other customer unit',s=>s.reservations.find(r=>r.order_id===RETENTION_SIBLING_ORDER).quantity=2],
 ['new customer reservation',s=>s.reservations.push({phase:'CART',product_id:RETENTION_ITEMS[3].productId,quantity:1,expires_at:null})],
 ['appointment',s=>s.appointments.push({status:'SCHEDULED'})],
 ['payment exception',s=>s.decisions.push({kind:'REQUIREMENT'})],
 ['additional audit activity',s=>s.events.push({...s.events[0],event_id:205})],
 ['inventory counter',s=>s.inventory[0].committed=0],
 ['operational control',s=>s.control.paused=true],
])test(`case guard rejects changed ${label}`,()=>{
 const copy=structuredClone(plan);change(copy.state);assert.throws(()=>validateOwnerRetentionPlan(copy));
});
test('no approval, REVIEWER actor and a stale fingerprint cannot execute a correction',async()=>{
 await assert.rejects(applyHistoricalOwnerRetention({}),/aprobación/);
 await assert.rejects(applyHistoricalOwnerRetention({...input(),actor:'REVIEWER'}),/propietario/);
 await assert.rejects(applyHistoricalOwnerRetention({...input(),expectedFingerprint:'0'.repeat(64)}),/estado cambió/);
 assert.deepEqual(await snapshot(),before);
});
test('failure after order and batch writes rolls back the entire correction',async()=>{
 await assert.rejects(applyHistoricalOwnerRetention(input(),{transaction:op=>db.transaction(tx=>op({query:(sql,p)=>{
  if(sql.startsWith('INSERT INTO fulfillment_batch_events'))throw Error('Synthetic audit failure');return tx.query(sql,p);
 }}))}),/Synthetic audit failure/);
 assert.deepEqual(await snapshot(),before);
});
test('correction appends no-cash evidence and closes without delivery; all financial evidence, inventory and unrelated records survive',async()=>{
 const result=await applyHistoricalOwnerRetention(input());assert.equal(result.alreadyApplied,false);
 const after=await snapshot();
 for(const t of tables.filter(t=>!['checkout_attempts','fulfillment_batches','fulfillment_batch_events'].includes(t)))assert.deepEqual(after[t],before[t],t);
 const old=before.checkout_attempts.find(o=>o.order_id===RETENTION_ORDER),current=after.checkout_attempts.find(o=>o.order_id===RETENTION_ORDER);
 const {ownerRetention,...historical}=current.order_snapshot;assert.deepEqual(historical,old.order_snapshot);
 assert.equal(ownerRetention.actualCashReceivedPYG,0);assert.equal(ownerRetention.actualCashRefundedPYG,0);assert.deepEqual(ownerRetention.retainedBy,['David','María']);
 assert.equal(current.projection_version,old.projection_version+1);assert.equal(current.committed_at,old.committed_at);
 assert.deepEqual(after.checkout_attempts.filter(o=>o.order_id!==RETENTION_ORDER),before.checkout_attempts.filter(o=>o.order_id!==RETENTION_ORDER));
 const batch=after.fulfillment_batches.find(b=>b.fulfillment_batch_id===RETENTION_BATCH);
 assert.equal(batch.status,CLOSED_OWNER_RETENTION);assert.equal(batch.revision,3);assert.equal(batch.delivered_at,null);assert.equal(batch.auto_attach,false);
 assert.deepEqual(after.fulfillment_batches.filter(b=>b.fulfillment_batch_id!==RETENTION_BATCH),before.fulfillment_batches.filter(b=>b.fulfillment_batch_id!==RETENTION_BATCH));
 for(const e of before.fulfillment_batch_events)assert.deepEqual(after.fulfillment_batch_events.find(a=>a.event_id===e.event_id),e);
 const added=after.fulfillment_batch_events.filter(e=>!before.fulfillment_batch_events.some(a=>a.event_id===e.event_id));
 assert.equal(added.length,1);assert.equal(added[0].event_type,'OWNER_RETENTION');assert.equal(added[0].actor,'OWNER');
 assert.equal((await applyHistoricalOwnerRetention(input())).alreadyApplied,true);assert.deepEqual(await snapshot(),after);
});
test('043/411/432 are NO LONGER FOR SALE; 466 retains one free unit, one customer sale and one owner unit',async()=>{
 const products=await loadCatalog('http://localhost',{loadBaseCatalog:async()=>fixture.products,listProductOverrides:async()=>[],readCommittedInventory});
 for(const p of products.filter(p=>p.itemNumber!==466)){
  assert.equal(p.status,'UNLISTED');assert.equal(p.quantityRemaining,0);assert.equal(p.quantitySold,0);assert.equal(p.quantityOwnerRetained,1);
  assert.deepEqual(p.images,fixture.products.find(i=>i.id===p.id).images);
 }
 const remaining=products.find(p=>p.itemNumber===466);assert.equal(remaining.status,'AVAILABLE');assert.equal(remaining.quantityRemaining,1);assert.equal(remaining.quantitySold,1);assert.equal(remaining.quantityOwnerRetained,1);
 assert.deepEqual(projectPublicCatalog(products,[]).products.map(p=>p.itemNumber),[466]);
 assert.deepEqual(await prices(),pricesBefore,'agreed and liquidation price logic must not change');
 await assert.rejects(claimCartLease({cartSessionId:randomUUID(),productId:products[0].id,quantity:1,availability:1}),/reservado/);
});
test('closed history cannot be delivered, reopened, combined, separated, reattached or used for payment/scheduling exceptions',async()=>{
 const o=(await db.query('SELECT order_snapshot FROM checkout_attempts WHERE order_id=$1',[RETENTION_ORDER])).rows[0].order_snapshot;
 assert.equal(orderSchedulingEligible(o),false);assert.ok(itemPaymentEligibility(o).every(i=>!i.handoverEligible&&!i.schedulingEligible));
 assert.ok(deriveOrderFulfillmentParts(o).every(p=>p.status==='OWNER_RETAINED'&&!p.eligible));
 const publicData=publicOrder(o);assert.equal(publicData.ownerRetention.kind,'NO_CASH_OWNER_RETENTION');
 for(const action of ['DELIVER','REOPEN','PREPARE'])await assert.rejects(db.transaction(tx=>transitionBatch(tx,{batchId:RETENTION_BATCH,action,expectedRevision:3})),/admite/);
 await assert.rejects(db.transaction(tx=>combineBatches(tx,{batchId:RETENTION_BATCH,targetBatchId:fixture.otherBatch,expectedRevision:3,expectedTargetRevision:2,confirmFrozen:true})),/retención/);
 await assert.rejects(db.transaction(tx=>separateItems(tx,{batchId:RETENTION_BATCH,orderId:RETENTION_ORDER,productIds:[RETENTION_ITEMS[0].productId],expectedRevision:3,confirmFrozen:true})),/retención/);
 await assert.rejects(appendItemPaymentDecision(RETENTION_ORDER,{kind:'REQUIREMENT',productId:RETENTION_ITEMS[0].productId,note:'Synthetic forbidden exception',schedulingRequiredPYG:0,collectionRequiredPYG:0}),/Retención/);
 for(const slotKey of [null,'2026-11-20|08:00-09:00'])await assert.rejects(changePickup({orderId:RETENTION_ORDER,timingKey:'IMMEDIATE',slotKey,actor:'CUSTOMER',itemIds:RETENTION_ITEMS.map(i=>i.productId)}),/Retención/);
 const beforeEnsure=await snapshot();await db.transaction(tx=>ensureFulfillmentAssignments(tx));assert.deepEqual(await snapshot(),beforeEnsure);
 assert.equal((await listFulfillmentBatches()).find(b=>b.fulfillmentBatchId===RETENTION_BATCH).status,CLOSED_OWNER_RETENTION);
 assert.equal(itemPaymentEligibility(fixture.sibling)[0].handoverEligible,true,'customer payment safeguards remain intact');
});
test('retention evidence, membership and original finances are immutable, but projection synchronization remains compatible',async()=>{
 for(const sql of [
  "UPDATE checkout_attempts SET order_snapshot=jsonb_set(order_snapshot,'{payments}','[]') WHERE order_id='VM-2026-514DA2AA'",
  "DELETE FROM checkout_attempts WHERE order_id='VM-2026-514DA2AA'",
  "UPDATE fulfillment_batches SET status='PREPARED' WHERE fulfillment_batch_id='0d646d9f-80ae-4db5-acd6-bce66eca410a'",
  "DELETE FROM fulfillment_batch_items WHERE order_id='VM-2026-514DA2AA'",
  "DELETE FROM fulfillment_batch_events WHERE event_type='OWNER_RETENTION'",
  'TRUNCATE checkout_attempts CASCADE','TRUNCATE fulfillment_batches CASCADE','TRUNCATE fulfillment_batch_items CASCADE','TRUNCATE fulfillment_batch_events',
 ])await assert.rejects(db.query(sql),/immutable/);
 await assert.rejects(recordOrderPostSalePriceAdjustment(RETENTION_ORDER,{amountPYG:1}),/Retención/);
 await assert.rejects(recordOrderReceipt(RETENTION_ORDER,{fileName:'forbidden'}),/Retención/);
 await assert.rejects(confirmOrderPayment(RETENTION_ORDER,{paymentType:'FULL'}),/Retención/);
 let projected;await synchronizeOrderProjection(RETENTION_ORDER,async snapshot=>{projected=snapshot});assert.equal(projected.ownerRetention.actualCashReceivedPYG,0);
 assert.deepEqual(projected.payments,fixture.order.payments);
});
test('Sale Pulse excludes the owner record from customer sales without changing historical order money',async()=>{
 const result=await loadSalePulseSnapshot('http://localhost',{query:(...a)=>db.query(...a),loadProducts:async()=>fixture.products});
 assert.equal(result.last24Hours.confirmedOrders,1);
 assert.equal((await db.query('SELECT order_snapshot FROM checkout_attempts WHERE order_id=$1',[RETENTION_ORDER])).rows[0].order_snapshot.payments[0].amountPYG,95000);
});
test('operator tool rejects incomplete approval and conflicting plan/apply flags before database access',()=>{
 const tool=new URL('../../../tools/owner-retention/correct-four-items.mjs',import.meta.url);
 for(const args of [['--apply'],['--plan','--apply']]){
  const result=spawnSync(process.execPath,[tool.pathname.replace(/^\/([A-Za-z]:)/,'$1'),...args],{encoding:'utf8'});
  assert.equal(result.status,2);assert.match(result.stderr,/STOP:/);
 }
});
