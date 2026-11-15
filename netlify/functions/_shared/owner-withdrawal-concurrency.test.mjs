import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {withdrawFromSale} from './owner-withdrawal.mjs';
import {claimCartLease,setInventoryDatabaseClientForTests} from './inventory-database.mjs';

const connectionString=process.env.PICKUP_TEST_DATABASE_URL;
let pool,control,schema;
test.before(async()=>{
 if(!connectionString)return;
 const u=new URL(connectionString);assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname));assert.match(u.pathname,/^\/pickup_test_[a-z0-9_]+$/);
 control=new pg.Pool({connectionString});schema='withdraw_test_'+randomUUID().replaceAll('-','');
 await control.query(`CREATE SCHEMA ${schema}`);pool=new pg.Pool({connectionString,max:8,options:`-c search_path=${schema}`});
 for(const m of ['20261001_operational_inventory','20261002_cart_extension','20261003_buyer_groups','20261009_fulfillment_batches','20261116_owner_withdrawal'])
   await pool.query(await readFile(new URL(`../../database/migrations/${m}.sql`,import.meta.url),'utf8'));
 setInventoryDatabaseClientForTests({pool});
});
test.after(async()=>{setInventoryDatabaseClientForTests(undefined);if(pool)await pool.end();if(control){await control.query(`DROP SCHEMA ${schema} CASCADE`);await control.end()}});
const product=()=>({id:randomUUID(),itemNumber:999,title:'Isolated',status:'AVAILABLE',quantityTotal:1,quantityRemaining:1,images:['/original']});
for(let i=0;i<3;i++)test(`independent SQL workers: claim versus withdrawal serializes safely (${i+1})`,{skip:!connectionString},async()=>{
 const p=product();await pool.query('INSERT INTO operational_inventory(product_id,capacity) VALUES($1,1)',[p.id]);
 const results=await Promise.allSettled([withdrawFromSale(p,{confirmed:true}),claimCartLease({cartSessionId:randomUUID(),productId:p.id,quantity:1,availability:1})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const row=(await pool.query('SELECT * FROM operational_inventory WHERE product_id=$1',[p.id])).rows[0];
 const holds=(await pool.query('SELECT * FROM inventory_reservations WHERE product_id=$1',[p.id])).rows;
 assert.equal(row.committed_quantity,0);
 assert.equal(Boolean(row.owner_withdrawal),holds.length===0);
});
test('independent duplicate owner requests preserve exactly one audit event',{skip:!connectionString},async()=>{
 const p=product();const events=await Promise.all([withdrawFromSale(p,{confirmed:true}),withdrawFromSale(p,{confirmed:true})]);
 assert.deepEqual(events[0],events[1]);assert.equal((await pool.query('SELECT count(*)::int n FROM operational_inventory WHERE product_id=$1 AND owner_withdrawal IS NOT NULL',[p.id])).rows[0].n,1);
});
