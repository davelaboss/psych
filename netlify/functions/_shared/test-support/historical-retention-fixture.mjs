import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {initializePickupControlForTests} from './pickup-control.mjs';
import {RETENTION_ORDER,RETENTION_BATCH,RETENTION_ITEMS,RETENTION_SIBLING_ORDER} from '../owner-retention-core.mjs';
export const migrationNames=['20261001_operational_inventory','20261002_cart_extension','20261003_buyer_groups',
 '20261004_order_reservation_events','20261005_pickup_notifications','20261006_notification_recipients',
 '20261009_fulfillment_batches','20261010_pickup_fulfillment_parts','20261102_pickup_blackouts',
 '20261014_sale_pulse_analytics','20261113_cart_pricing','20261114_item_payment_pickup','20261116_owner_withdrawal','20261117_admin_sessions'];
export async function migrateRetentionFixture(db,{correction=true}={}){
 const exec=sql=>db.exec?db.exec(sql):db.query(sql);
 for(const m of migrationNames)await exec(await readFile(new URL(`../../../database/migrations/${m}.sql`,import.meta.url),'utf8'));
 await initializePickupControlForTests(db);
 if(correction)await exec(await readFile(new URL('../../../database/migrations/20261118_historical_owner_retention.sql',import.meta.url),'utf8'));
}
export async function seedRetentionFixture(db){
 const ownSession=randomUUID(),otherSession=randomUUID(),group=randomUUID(),otherGroup=randomUUID(),otherBatch='1705b681-2ece-4816-b30c-e3740ef0950e';
 const items=RETENTION_ITEMS.map((i,n)=>({...i,title:'Synthetic Item '+i.itemNumber,slug:'synthetic-'+i.itemNumber,image:'/original-'+i.itemNumber+'.webp',
  saleMode:'IMMEDIATE',unitPricePYG:[9000,28000,30000,28000][n],dueNowPYG:[9000,28000,30000,28000][n],futureBalancePYG:0}));
 const order={id:RETENTION_ORDER,status:'PAYMENT_CONFIRMED',buyer:{name:'Synthetic original record',phone:'000'},items,
  totals:{totalPYG:95000,dueNowPYG:95000,futureBalancePYG:0},
  payments:[{id:'c5929d87-e991-41bb-a468-2ddca8605c6d',type:'FULL',amountPYG:95000,amountSource:'ADMIN_VERIFIED',verificationStatus:'CONFIRMED',verifiedBy:'ADMIN',receipt:{fileName:'synthetic-original.png',storageKey:'synthetic-only'}}],
  paymentAdjustments:[{id:'375c0bab-e233-45c2-ad12-2ecb8db53a55',kind:'POST_SALE_PRICE_ADJUSTMENT',amountPYG:95000,internalNote:'Internal'}]};
 const sibling={id:RETENTION_SIBLING_ORDER,status:'PAYMENT_CONFIRMED',buyer:{name:'Other synthetic customer',phone:'000'},items:[items[3]],
  totals:{totalPYG:28000,dueNowPYG:28000,futureBalancePYG:0},payments:[{id:'synthetic-paid',amountPYG:28000,amountSource:'ADMIN_VERIFIED',verificationStatus:'CONFIRMED',verifiedBy:'ADMIN'}],paymentAdjustments:[]};
 for(const [o,s,g] of [[order,ownSession,group],[sibling,otherSession,otherGroup]]){
  await db.query('INSERT INTO cart_sessions(session_id) VALUES($1)',[s]);
  await db.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,committed_at)
   VALUES($1,$2,$3,0,'synthetic',$4,clock_timestamp())`,[o.id,s,randomUUID(),JSON.stringify(o)]);
  await db.query('INSERT INTO buyer_groups(buyer_group_id,display_name) VALUES($1,$2)',[g,o.buyer.name]);
  await db.query(`INSERT INTO buyer_group_orders(order_id,buyer_group_id,normalized_name,normalized_phone,assignment_mode)
   VALUES($1,$2,$3,'000','AUTO_NEW')`,[o.id,g,o.buyer.name]);
 }
 for(const i of items){
  await db.query('INSERT INTO operational_inventory(product_id,capacity,committed_quantity) VALUES($1,$2,$3)',[i.productId,i.itemNumber===466?3:1,i.itemNumber===466?2:1]);
  await db.query("INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,order_id) VALUES($1,$2,1,'COMMITTED',$3)",[i.productId,ownSession,RETENTION_ORDER]);
 }
 await db.query("INSERT INTO inventory_reservations(product_id,session_id,quantity,phase,order_id) VALUES($1,$2,1,'COMMITTED',$3)",[items[3].productId,otherSession,RETENTION_SIBLING_ORDER]);
 for(const [id,g,o] of [[RETENTION_BATCH,group,order],[otherBatch,otherGroup,sibling]]){
  await db.query(`INSERT INTO fulfillment_batches(fulfillment_batch_id,buyer_group_id,timing_key,status,auto_attach,revision,prepared_at)
   VALUES($1,$2,'IMMEDIATE','PREPARED',false,2,clock_timestamp())`,[id,g]);
  for(const i of o.items)await db.query("INSERT INTO fulfillment_batch_items(order_id,product_id,fulfillment_batch_id,assignment_mode) VALUES($1,$2,$3,'AUTO_NEW')",[o.id,i.productId,id]);
  await db.query(`INSERT INTO fulfillment_batch_events(event_id,event_type,fulfillment_batch_id,actor,affected_items)
   OVERRIDING SYSTEM VALUE VALUES($1,'PREPARE',$2,'ADMIN',$3)`,[id===RETENTION_BATCH?204:227,id,JSON.stringify(o.items.map(i=>({orderId:o.id,productId:i.productId})))]);
 }
 await db.query("SELECT setval(pg_get_serial_sequence('fulfillment_batch_events','event_id'),227)");
 await db.query("INSERT INTO pickup_windows(slot_key) VALUES('2026-11-20|08:00-09:00')");
 await db.query(`INSERT INTO pickup_appointments(order_id,timing_key,slot_key,status,changed_by,revision,item_ids)
 VALUES($1,'IMMEDIATE','2026-11-20|08:00-09:00','SCHEDULED','ADMIN',1,$2)`,[RETENTION_SIBLING_ORDER,[items[3].productId]]);
 return {order,sibling,otherBatch,items,products:items.map(i=>({id:i.productId,itemNumber:i.itemNumber,title:i.title,slug:i.slug,
  status:'AVAILABLE',quantityTotal:i.itemNumber===466?3:1,quantityRemaining:i.itemNumber===466?3:1,quantitySold:0,
  images:[i.image],askingPricePYG:i.unitPricePYG,saleMode:'IMMEDIATE',depositPercent:100}))};
}
