import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {PGlite} from '@electric-sql/pglite';
import {migrateRetentionFixture,seedRetentionFixture} from './test-support/historical-retention-fixture.mjs';
import {readOwnerRetentionPlan,applyHistoricalOwnerRetention} from './historical-owner-retention.mjs';
import {RETENTION_ORDER,RETENTION_BATCH} from './owner-retention-core.mjs';
import {setInventoryDatabaseClientForTests} from './inventory-database.mjs';
import {publicOrder} from './commerce.mjs';
import {withPaymentState} from './order-payments.mjs';
import {listFulfillmentBatches} from './fulfillment-batches.mjs';

let browser,db,order,sibling,batches;
const admin=await readFile(new URL('../../../js/admin.js',import.meta.url),'utf8');
const checkout=await readFile(new URL('../../../js/checkout.js',import.meta.url),'utf8');
const css=await readFile(new URL('../../../css/site.css',import.meta.url),'utf8');
const site=await readFile(new URL('../../../js/site.js',import.meta.url),'utf8');
test.before(async()=>{
 db=new PGlite();setInventoryDatabaseClientForTests({pool:{query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})}});
 await migrateRetentionFixture(db);const fixture=await seedRetentionFixture(db);
 const plan=await readOwnerRetentionPlan(db);await applyHistoricalOwnerRetention({expectedFingerprint:plan.fingerprint,approvalReference:'ISOLATED BROWSER FIXTURE'});
 order=withPaymentState((await db.query('SELECT order_snapshot FROM checkout_attempts WHERE order_id=$1',[RETENTION_ORDER])).rows[0].order_snapshot);
 sibling=withPaymentState(fixture.sibling);batches=await listFulfillmentBatches();browser=await chromium.launch({headless:true});
});
test.after(async()=>{await browser?.close();setInventoryDatabaseClientForTests(undefined);await db?.close()});
for(const mobile of [false,true])test(`${mobile?'mobile':'desktop'} retained order and closed batch show truthful read-only history; customer view offers no purchase/payment/delivery actions`,async()=>{
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main style="max-width:1000px;margin:auto;padding:16px"></main></html>`}));
 await page.goto('https://isolated.test/harness');await page.addScriptTag({content:admin});
 await page.evaluate(({order,sibling,batches})=>{
   ADMIN_STATE.orders=[order,sibling];ADMIN_STATE.fulfillmentBatches=batches;injectAdminStyles();
   renderAdminOrderDetail(order,document.querySelector('main'));
 },{order,sibling,batches});
 assert.match(await page.locator('main').innerText(),/sin dinero ni entrega/);assert.match(await page.locator('main').innerText(),/95[.,]000/);
 assert.equal(await page.locator('main button,main input,main form').count(),0);
 const state=await page.evaluate(({order,sibling})=>({active:adminOrderMatchesFilter(order,'ACTIVE'),paid:adminOrderMatchesFilter(order,'PAID'),all:adminOrderMatchesFilter(order,'ALL'),count:buildAdminStats([order,sibling],[]).confirmed}),{order,sibling});
 assert.deepEqual(state,{active:false,paid:false,all:true,count:1});
 await page.evaluate(batchId=>{document.querySelector('main').innerHTML=renderFulfillmentBatchSheet(ADMIN_STATE.fulfillmentBatches.find(b=>b.fulfillmentBatchId===batchId))},RETENTION_BATCH);
 assert.match(await page.locator('main').innerText(),/cerrada sin entrega/);assert.equal(await page.locator('main button,input,select').count(),0);
 const visible=await page.evaluate(()=>({pending:fulfillmentBatchesForFilter('UNDELIVERED').map(b=>b.fulfillmentBatchId),all:fulfillmentBatchesForFilter('ALL').map(b=>b.fulfillmentBatchId)}));
 assert.ok(!visible.pending.includes(RETENTION_BATCH));assert.ok(visible.all.includes(RETENTION_BATCH));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.addScriptTag({content:site.slice(site.indexOf('function formatPYG('))});await page.addScriptTag({content:checkout});
 await page.evaluate(o=>displayOrder(o,'synthetic-private-link'),publicOrder(order));
 assert.match(await page.locator('main').innerText(),/No hubo intercambio real de dinero/);
 assert.equal(await page.locator('main button,input,form').count(),0);assert.deepEqual(errors,[]);await page.close();
});
