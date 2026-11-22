import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { correctMarketplaceOrder, previewMarketplaceCorrection, ORDER_ID, CORRECTION_ID } from './marketplace-order-correction.mjs';
import { setInventoryDatabaseClientForTests, confirmOrderPayment, cancelOrder, synchronizeOrderProjection, readPurchasableInventory } from './inventory-database.mjs';
import { createMarketplaceCorrectionHandler } from '../admin-correct-marketplace-order.mjs';
import { publicOrder } from './commerce.mjs';

const url = process.env.ORDER_CORRECTION_TEST_DATABASE_URL;
let pool, control, schema, original;
const ids = ['real-202610-volume4-369','real-202610-volume4-402','real-202610-volume4-454','real-202611-volume6-643'];
const paymentId = 'synthetic-payment';
const input = () => ({ action:'CORRECT_AND_CONFIRM', expectedVersion:2, verifiedAmountPYG:30000,
  paymentId, approvalReference:'Synthetic owner approval; bank verified' });
const originalFetch = globalThis.fetch;
const originalAdminToken = process.env.ADMIN_TOKEN;

test.before(async () => {
  if (!url) throw new Error('Set ORDER_CORRECTION_TEST_DATABASE_URL to an expendable local correction_test_ database.');
  const parsed = new URL(url);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname));
  assert.match(parsed.pathname, /^\/correction_test_[a-z0-9_]+$/);
  control = new pg.Pool({ connectionString:url });
  process.env.ADMIN_TOKEN = 'local-correction-test';
  globalThis.fetch = async () => { throw new Error('External requests prohibited in correction tests'); };
});

test.beforeEach(async () => {
  schema = `correction_${randomUUID().replaceAll('-','')}`;
  await control.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({ connectionString:url, max:8, options:`-c search_path=${schema}` });
  for (const migration of ['20261001_operational_inventory','20261003_buyer_groups',
    '20261004_order_reservation_events','20261005_pickup_notifications','20261006_notification_recipients',
    '20261009_fulfillment_batches','20261113_cart_pricing','20261114_item_payment_pickup','20261116_owner_withdrawal']) {
    await pool.query(await readFile(new URL(`../../database/migrations/${migration}.sql`,import.meta.url),'utf8'));
  }
  setInventoryDatabaseClientForTests({ pool });
  const session = randomUUID();
  const receipt = { storageKey:'synthetic/receipt',fileName:'synthetic.jpeg',contentType:'image/jpeg',uploadedAt:123,uploadedBy:'CUSTOMER' };
  original = { id:ORDER_ID, buyer:{name:'Synthetic Buyer',phone:'000',email:'buyer@example.invalid'},
    accessTokenHash:'synthetic-access-hash',createdAt:100,updatedAt:123,pickup:null,
    status:'RECEIPT_RECEIVED',reservationState:'PROTECTED',holdExpiresAt:null,
    totals:{totalPYG:78700,dueNowPYG:78700,futureBalancePYG:0},receipt,
    items:ids.map((id,i) => ({ productId:id,itemNumber:[369,402,454,643][i],quantity:1,
      unitPricePYG:[17500,40000,14000,7200][i],dueNowPYG:[17500,40000,14000,7200][i],
      futureBalancePYG:0,saleMode:'IMMEDIATE',depositPercent:100,
      liquidation:{id:'synthetic-campaign',percent:i===3?10:50} })),
    payments:[{id:paymentId,type:'PENDING',amountPYG:null,confirmedAt:null,verificationStatus:'PENDING',receipt,
      submittedBy:'CUSTOMER',submittedAt:123,paymentMethod:'BANK_TRANSFER'}],paymentAdjustments:[],
    paymentNotes:[{id:'existing-note',kind:'INTERNAL',text:'Preserve this history'}] };
  await pool.query('INSERT INTO cart_sessions(session_id) VALUES($1)',[session]);
  await pool.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,
    projection_version,blob_synced_version) VALUES($1,$2,$3,0,'original-fingerprint',$4,2,2)`,[ORDER_ID,session,randomUUID(),JSON.stringify(original)]);
  for (const id of ids) {
    await pool.query('INSERT INTO operational_inventory(product_id,capacity) VALUES($1,1)',[id]);
    await pool.query("INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,order_id) VALUES($1,$2,1,'ORDER',$3)",[id,session,ORDER_ID]);
  }
  await pool.query("INSERT INTO operational_inventory(product_id,capacity) VALUES('unrelated-product',5)");
});

test.afterEach(async () => {
  setInventoryDatabaseClientForTests(undefined);
  if(pool) await pool.end();
  if(control && schema) await control.query(`DROP SCHEMA ${schema} CASCADE`);
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = originalAdminToken;
  if(control) await control.end();
});

async function state() {
  const row = (await pool.query('SELECT * FROM checkout_attempts WHERE order_id=$1',[ORDER_ID])).rows[0];
  return {row, reservations:(await pool.query('SELECT product_id,quantity,phase,expires_at FROM inventory_reservations ORDER BY product_id')).rows,
    products:(await pool.query('SELECT * FROM operational_inventory ORDER BY product_id')).rows,
    notifications:(await pool.query('SELECT * FROM seller_notifications')).rows};
}

test('preview is read-only; atomic correction preserves history, releases three holds, confirms and commits only 369',async () => {
  const before=await state();
  assert.equal((await previewMarketplaceCorrection()).correctedTotalPYG,30000);
  assert.deepEqual(await state(),before);
  const result=await correctMarketplaceOrder(input());
  assert.equal(result.idempotent,false);
  const s=await state(), o=s.row.order_snapshot;
  assert.equal(o.items.length,1);assert.equal(o.items[0].unitPricePYG,30000);assert.equal(o.items[0].liquidation,undefined);
  assert.deepEqual(o.totals,{totalPYG:30000,dueNowPYG:30000,futureBalancePYG:0});
  assert.equal(o.paidAmountPYG,30000);assert.equal(o.remainingBalancePYG,0);assert.equal(o.paymentState,'FULLY_PAID');
  assert.equal(o.status,'PAYMENT_CONFIRMED');assert.equal(o.pickup,null);
  assert.deepEqual(o.buyer,original.buyer);assert.equal(o.accessTokenHash,original.accessTokenHash);
  assert.deepEqual(o.receipt,original.receipt);assert.deepEqual(o.paymentNotes.slice(0,-1),original.paymentNotes);
  assert.equal(o.paymentNotes.at(-1).kind,'ORDER_CORRECTION');
  assert.deepEqual(o.payments[0].receipt,original.payments[0].receipt);assert.equal(o.payments[0].id,paymentId);
  assert.equal(o.payments[0].amountSource,'ADMIN_VERIFIED');assert.equal(o.payments[0].amountPYG,30000);
  const expected=structuredClone(original);delete expected.accessTokenHash;
  assert.deepEqual(o.orderCorrections[0].before,expected);assert.equal(o.orderCorrections[0].id,CORRECTION_ID);
  assert.equal(s.row.projection_version,3);assert.equal(s.row.blob_synced_version,2);
  assert.equal(s.row.request_fingerprint,'original-fingerprint');assert.ok(s.row.committed_at);
  assert.deepEqual(s.reservations,[{product_id:ids[0],quantity:1,phase:'COMMITTED',expires_at:null}]);
  assert.deepEqual(s.products.map(p=>[p.product_id,p.capacity,p.committed_quantity]),
    [...ids.map((id,i)=>[id,1,i===0?1:0]),['unrelated-product',5,0]]);
  assert.deepEqual(s.products.find(p=>p.product_id==='unrelated-product'),before.products.find(p=>p.product_id==='unrelated-product'));
  const available=await readPurchasableInventory();
  for(let i=0;i<4;i++)assert.equal(Number(available.get(ids[i]).purchasable_quantity),i===0?0:1);
  assert.equal(s.notifications.length,0);
  assert.equal((await pool.query('SELECT * FROM pickup_appointments')).rowCount,0);
  assert.equal((await pool.query('SELECT * FROM fulfillment_batch_items')).rowCount,0);
  assert.equal(publicOrder(o).orderCorrections,undefined);
});

test('two independent correction requests release and commit once; subsequent retry makes no database changes',async () => {
  const results=await Promise.all([correctMarketplaceOrder(input()),correctMarketplaceOrder(input())]);
  assert.deepEqual(results.map(r=>r.idempotent).sort(),[false,true]);
  const before=await state();assert.equal((await correctMarketplaceOrder(input())).idempotent,true);
  assert.deepEqual(await state(),before);assert.equal(before.row.order_snapshot.orderCorrections.length,1);
});

for(const [label,change] of [
  ['version',()=>pool.query('UPDATE checkout_attempts SET projection_version=3 WHERE order_id=$1',[ORDER_ID])],
  ['reservation',()=>pool.query('DELETE FROM inventory_reservations WHERE order_id=$1 AND product_id=$2',[ORDER_ID,ids[1]])],
  ['payment',()=>pool.query("UPDATE checkout_attempts SET order_snapshot=jsonb_set(order_snapshot,'{payments,0,id}','\"changed-payment\"') WHERE order_id=$1",[ORDER_ID])],
  ['price',()=>pool.query("UPDATE checkout_attempts SET order_snapshot=jsonb_set(order_snapshot,'{items,0,unitPricePYG}','18000') WHERE order_id=$1",[ORDER_ID])],
  ['fulfillment',()=>pool.query("INSERT INTO item_payment_decisions(id,order_id,kind,product_id,scheduling_required_pyg,collection_required_pyg,actor,note) VALUES($1,$2,'REQUIREMENT',$3,0,0,'ADMIN','Synthetic changed state')",[randomUUID(),ORDER_ID,ids[0]])],
]) test(`changed ${label} aborts without further mutation`,async()=>{
  await change();const before=await state();await assert.rejects(correctMarketplaceOrder(input()),{status:409});assert.deepEqual(await state(),before);
});

test('wrong payment, amount, version and missing authorization reference fail without changes',async()=>{
  const before=await state();
  for(const patch of [{paymentId:'wrong'},{verifiedAmountPYG:78700},{expectedVersion:3},{approvalReference:''}]){
    await assert.rejects(correctMarketplaceOrder({...input(),...patch}));assert.deepEqual(await state(),before);
  }
});

test('failure after release rolls back reservations, payment, commitment and audit together',async()=>{
  await pool.query("CREATE FUNCTION reject_correction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_snapshot ? 'orderCorrections' THEN RAISE EXCEPTION 'injected write failure'; END IF; RETURN NEW; END $$");
  await pool.query('CREATE TRIGGER reject_correction BEFORE UPDATE ON checkout_attempts FOR EACH ROW EXECUTE FUNCTION reject_correction()');
  try {const before=await state();await assert.rejects(correctMarketplaceOrder(input()),/injected write failure/);assert.deepEqual(await state(),before);}
  finally {await pool.query('DROP TRIGGER reject_correction ON checkout_attempts');await pool.query('DROP FUNCTION reject_correction()');}
});

test('concurrent cancellation and correction serialize; neither leaves a partial correction',async()=>{
  const results=await Promise.allSettled([cancelOrder(ORDER_ID),correctMarketplaceOrder(input())]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const s=await state();
  if(s.row.order_snapshot.status==='CANCELLED'){
    assert.equal(s.row.order_snapshot.orderCorrections,undefined);assert.equal(s.reservations.length,0);
    assert.ok(s.products.every(p=>p.committed_quantity===0));
  }else{assert.equal(s.reservations.length,1);assert.equal(s.row.order_snapshot.paidAmountPYG,30000);}
});

test('a concurrent bank confirmation wins first; correction rechecks under the order lock and aborts',async()=>{
  const gate=await pool.connect();await gate.query('BEGIN');
  await gate.query('SELECT * FROM checkout_attempts WHERE order_id=$1 FOR UPDATE',[ORDER_ID]);
  const confirmation=confirmOrderPayment(ORDER_ID,{paymentId,paymentType:'FULL',verifiedAmountPYG:78700});
  // Observe the actual blocked SQL worker before queueing the correction behind it.
  for(let n=0;n<100;n++){
    const waiting=await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM checkout_attempts WHERE order_id=%FOR UPDATE'");
    if(waiting.rows[0].n)break;
    if(n===99)throw new Error('Confirmation did not reach its order lock');
    await new Promise(r=>setTimeout(r,10));
  }
  const correction=assert.rejects(correctMarketplaceOrder(input()),{status:409});
  await gate.query('COMMIT');gate.release();await confirmation;await correction;
  const s=await state();assert.equal(s.row.order_snapshot.orderCorrections,undefined);
  assert.equal(s.row.order_snapshot.paidAmountPYG,78700);assert.equal(s.reservations.length,4);
  assert.ok(s.reservations.every(r=>r.phase==='COMMITTED'));
});

test('projection failure returns committed result; exact retry repairs the projection without confirming twice',async()=>{
  let failProjection=true, blob;
  const handler=createMarketplaceCorrectionHandler({authorized:()=>true,
    recover:()=>synchronizeOrderProjection(ORDER_ID,async(snapshot,version)=>{
      if(failProjection){failProjection=false;throw new Error('synthetic Blob failure');}
      blob={...snapshot,_inventoryVersion:version};
    })});
  const request=()=>new Request('https://example.invalid/.netlify/functions/admin-correct-marketplace-order',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input())});
  const first=await handler(request());assert.equal(first.status,503);assert.equal((await first.json()).committed,true);
  const committed=await state();assert.equal(committed.row.projection_version,3);assert.equal(committed.row.blob_synced_version,2);
  const retry=await handler(request());assert.equal(retry.status,200);assert.equal((await retry.json()).idempotent,true);
  const synced=await state();assert.equal(synced.row.blob_synced_version,3);assert.equal(blob._inventoryVersion,3);
  assert.deepEqual(blob.items,synced.row.order_snapshot.items);assert.deepEqual(blob.orderCorrections,synced.row.order_snapshot.orderCorrections);
  assert.deepEqual(synced.reservations,committed.reservations);assert.deepEqual(synced.products,committed.products);
  assert.equal(synced.notifications.length,0);
});

test('endpoint rejects unauthenticated requests and GET never synchronizes or mutates',async()=>{
  let calls=0;
  const handler=createMarketplaceCorrectionHandler({authorized:()=>false,correct:()=>{calls++;},recover:()=>{calls++;}});
  assert.equal((await handler(new Request('https://example.invalid',{method:'POST'}))).status,401);assert.equal(calls,0);
  const preview=createMarketplaceCorrectionHandler({authorized:()=>true,recover:()=>{throw new Error('GET must not recover');}});
  const before=await state();assert.equal((await preview(new Request('https://example.invalid'))).status,200);assert.deepEqual(await state(),before);
});

// LOCAL OFFLINE INTEGRATION HARNESS ONLY. Not part of either PR and not pushed.
test('combined PR86/87: synthetic correction, assignment, preparation, concurrent delivery/retry and financial preservation',async()=>{
  const {listFulfillmentBatches,mutateFulfillmentBatch}=await import('./fulfillment-batches.mjs');
  const before=await state();
  assert.deepEqual(await listFulfillmentBatches(),[],'uncommitted order receives no fulfillment membership');
  assert.deepEqual(await state(),before,'viewing fulfillment cannot commit or alter the original order');

  await correctMarketplaceOrder(input());
  const corrected=await state();
  assert.deepEqual(corrected.row.order_snapshot.items.map(i=>i.productId),[ids[0]]);
  assert.deepEqual((await pool.query('SELECT * FROM fulfillment_batch_items WHERE order_id=$1',[ORDER_ID])).rows,[]);
  const [batch]=await listFulfillmentBatches();
  assert.equal(batch.status,'OPEN');
  assert.deepEqual(batch.items.map(i=>i.productId),[ids[0]],'only corrected Item 369 can be assigned');
  assert.deepEqual(await state(),corrected);

  const [prepared]=await mutateFulfillmentBatch({action:'PREPARE',batchId:batch.fulfillmentBatchId,expectedRevision:batch.revision});
  assert.equal(prepared.status,'PREPARED');
  const delivery={action:'DELIVER',batchId:prepared.fulfillmentBatchId,expectedRevision:prepared.revision};
  const [delivered,retry]=await Promise.all([mutateFulfillmentBatch(delivery),correctMarketplaceOrder(input())]);
  assert.equal(delivered[0].status,'DELIVERED');
  assert.deepEqual(delivered[0].items.map(i=>i.productId),[ids[0]]);
  assert.equal(retry.idempotent,true);
  assert.deepEqual(await state(),corrected,'delivery/retry must not change payment, receipt, correction audit, inventory or notifications');
  const events=(await pool.query("SELECT * FROM fulfillment_batch_events WHERE fulfillment_batch_id=$1 ORDER BY event_id",[batch.fulfillmentBatchId])).rows;
  assert.deepEqual(events.map(e=>e.event_type),['PREPARE','DELIVER']);
  assert.deepEqual(events[1].affected_items,[{orderId:ORDER_ID,productId:ids[0]}]);
  assert.deepEqual(events[1].context,{},'verified full payment requires no OWNER override');
  await assert.rejects(mutateFulfillmentBatch(delivery),e=>e.code==='FULFILLMENT_REVISION_CONFLICT');
  assert.equal((await pool.query("SELECT * FROM fulfillment_batch_events WHERE event_type='DELIVER'")).rowCount,1);
  assert.deepEqual(await state(),corrected);
});
