import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {migrateRetentionFixture,seedRetentionFixture} from './test-support/historical-retention-fixture.mjs';
import {readOwnerRetentionPlan,applyHistoricalOwnerRetention} from './historical-owner-retention.mjs';
import {RETENTION_ORDER,RETENTION_ITEMS,RETENTION_SIBLING_ORDER} from './owner-retention-core.mjs';
import {setInventoryDatabaseClientForTests,claimCartLease} from './inventory-database.mjs';
const connectionString=process.env.PICKUP_TEST_DATABASE_URL;let pool,control,schema,plan;
test.beforeEach(async()=>{
 if(!connectionString)return;
 const u=new URL(connectionString);assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));assert.match(u.pathname,/^\/pickup_test_[a-z0-9_]+$/);
 control=new pg.Pool({connectionString});schema='retention_test_'+randomUUID().replaceAll('-','');await control.query(`CREATE SCHEMA ${schema}`);
 pool=new pg.Pool({connectionString,max:8,options:`-c search_path=${schema}`});await migrateRetentionFixture(pool);await seedRetentionFixture(pool);
 setInventoryDatabaseClientForTests({pool});plan=await readOwnerRetentionPlan(pool);
});
test.afterEach(async()=>{setInventoryDatabaseClientForTests(undefined);if(pool)await pool.end();if(control){assert.match(schema,/^retention_test_[a-f0-9]+$/);await control.query(`DROP SCHEMA ${schema} CASCADE`);await control.end()}pool=control=null});
const input=()=>({expectedFingerprint:plan.fingerprint,approvalReference:'ISOLATED CONCURRENT OWNER APPROVAL'});
test('independent SQL workers apply an exact correction once; retry records no duplicate audit or delivery',{skip:!connectionString},async()=>{
 const results=await Promise.all([applyHistoricalOwnerRetention(input()),applyHistoricalOwnerRetention(input())]);
 assert.deepEqual(results.map(r=>r.alreadyApplied).sort(),[false,true]);
 assert.equal((await pool.query("SELECT count(*)::int n FROM fulfillment_batch_events WHERE event_type='OWNER_RETENTION'")).rows[0].n,1);
 assert.equal((await pool.query("SELECT count(*)::int n FROM fulfillment_batch_events WHERE event_type='DELIVER'")).rows[0].n,0);
});
for(let n=0;n<2;n++)test(`a concurrent legitimate claim of the free 466 unit is preserved (${n+1})`,{skip:!connectionString},async()=>{
 const results=await Promise.allSettled([applyHistoricalOwnerRetention(input()),claimCartLease({cartSessionId:randomUUID(),productId:RETENTION_ITEMS[3].productId,quantity:1,availability:1})]);
 assert.equal(results[1].status,'fulfilled');
 const stock=(await pool.query('SELECT capacity,committed_quantity FROM operational_inventory WHERE product_id=$1',[RETENTION_ITEMS[3].productId])).rows[0];assert.deepEqual(stock,{capacity:3,committed_quantity:2});
 assert.equal((await pool.query("SELECT quantity FROM inventory_reservations WHERE order_id=$1 AND phase='COMMITTED'",[RETENTION_SIBLING_ORDER])).rows[0].quantity,1);
 const current=(await pool.query('SELECT order_snapshot FROM checkout_attempts WHERE order_id=$1',[RETENTION_ORDER])).rows[0].order_snapshot;
 if(results[0].status==='fulfilled')assert.equal(current.ownerRetention.actualCashReceivedPYG,0);
 else{assert.equal(current.ownerRetention,undefined);assert.equal(results[0].reason.status,409);}
 assert.equal((await pool.query("SELECT count(*)::int n FROM inventory_reservations WHERE product_id=$1 AND phase='CART'",[RETENTION_ITEMS[3].productId])).rows[0].n,1);
});
