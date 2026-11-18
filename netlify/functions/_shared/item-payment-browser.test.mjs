import { readPickupWriteControl, setPickupWriteControl } from './pickup-write-control.mjs';
import { createPickupContainmentHandler } from '../admin-pickup-containment.mjs';
import { initializePickupControlForTests } from './test-support/pickup-control.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { changePickup, pickupFulfillments } from './pickup.mjs';
import { appendItemPaymentDecision, readItemPaymentDecisions } from './item-payment-decisions.mjs';
import { setInventoryDatabaseClientForTests } from './inventory-database.mjs';

let db,browser;
const assets=Object.fromEntries(await Promise.all(['js/checkout.js','js/admin.js','js/admin-retiros.js','css/site.css'].map(async f=>[f,await readFile(new URL(`../../../${f}`,import.meta.url),'utf8')])));
const site = await readFile(new URL('../../../js/site.js',import.meta.url),'utf8');
const siteHelpers = site.slice(site.indexOf('function formatPYG('));

test.before(async()=>{
  db=new PGlite(); browser=await chromium.launch({headless:true});
  for(const name of ['20261001_operational_inventory','20261005_pickup_notifications','20261006_notification_recipients','20261010_pickup_fulfillment_parts','20261102_pickup_blackouts','20261114_item_payment_pickup']) await db.exec(await readFile(new URL(`../../database/migrations/${name}.sql`,import.meta.url),'utf8'));
  await initializePickupControlForTests(db);
  setInventoryDatabaseClientForTests({pool:{query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})}});
});
test.beforeEach(async()=>{const state=await readPickupWriteControl();if(state.paused)await setPickupWriteControl({id:randomUUID(),paused:false,expectedRevision:state.revision,reason:'Reset isolated test fixture'});});

test.after(async()=>{await browser.close();await db.close();setInventoryDatabaseClientForTests(undefined);});

for(const mobile of [false,true]) for(const kind of ['customer','admin']) test(`${kind} ${mobile?'mobile':'desktop'} shows per-Item eligibility, preserves a stale appointment, and sends explicit membership`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-14T12:00:00Z')});
  const session=randomUUID(),id=`VM-DEMO-${randomUUID()}`;
  const items=[381,449,474].map((n,i)=>({productId:String(n),itemNumber:n,title:`Artículo ${n}`,quantity:1,unitPricePYG:100,
    saleMode:i===2?'DELAYED':'IMMEDIATE',dueNowPYG:i===2?25:100,futureBalancePYG:i===2?75:0,
    pickupWindowStart:i===2?'2026-12-09':null,pickupWindowEnd:i===2?'2026-12-12':null}));
  const order={id,status:'DEPOSIT_CONFIRMED',buyer:{name:'Demostración',phone:'000'},items,
    totals:{totalPYG:300,dueNowPYG:225,futureBalancePYG:75},payments:[{id:'paid',amountPYG:225,amountSource:'ADMIN_VERIFIED',verifiedBy:'ADMIN',verificationStatus:'CONFIRMED'}],paymentAdjustments:[]};
  await db.query('INSERT INTO cart_sessions(session_id) VALUES($1)',[session]);
  await db.query(`INSERT INTO checkout_attempts(order_id,session_id,checkout_id,cart_generation,request_fingerprint,order_snapshot,committed_at)
    VALUES($1,$2,$3,0,'synthetic',$4,clock_timestamp())`,[id,session,randomUUID(),JSON.stringify(order)]);
  const decision=await appendItemPaymentDecision(id,{kind:'ALLOCATE',productId:'381',paymentId:'paid',amountPYG:100,note:'Synthetic confirmed allocation'});
  await appendItemPaymentDecision(id,{kind:'ALLOCATE',productId:'474',paymentId:'paid',amountPYG:25,note:'Synthetic deposit allocation'});
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});
  const errors=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/harness') return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${assets['css/site.css']}</style></head><body><main style="max-width:900px;margin:auto;padding:16px"><section id="pickup-scheduler"></section><section id="admin-pickup-editor"></section><section id="admin-upcoming-pickups"></section></main></body></html>`});
    if(url.pathname==='/api/admin/item-payment') {
      const body=request.postDataJSON(); await appendItemPaymentDecision(id,body);
      return route.fulfill({json:{ok:true}});
    }
    if(url.pathname==='/api/admin/pickup' || url.pathname==='/api/orders/pickup') {
      if(request.method()==='POST') {
        const body=request.postDataJSON();posts.push(body);
        try {await changePickup({...body,actor:kind==='admin'?'ADMIN':'CUSTOMER'},{queueNotifications:async()=>{}});}
        catch(e){return route.fulfill({status:e.status||500,json:{error:e.message}});}
      }
      return route.fulfill({json:{ok:true,fulfillments:await pickupFulfillments(order),decisions:kind==='admin'?await readItemPaymentDecisions(id):undefined,upcoming:[]}});
    }
    return route.abort();
  });
  await page.goto('https://pickup.test/harness');
  if (kind === 'customer') await page.addScriptTag({content:siteHelpers});
  await page.addScriptTag({content:assets[kind==='admin'?'js/admin.js':'js/checkout.js']});
  await page.evaluate(async({order,kind})=>{
    if(kind==='admin'){ADMIN_STATE.token='synthetic';injectAdminStyles();await setupAdminPickup(order);}
    else {injectCheckoutStyles();await setupPickupScheduler(order,'synthetic-access');}
  },{order,kind});
  const target=page.locator(kind==='admin'?'#admin-pickup-editor':'#pickup-scheduler');
  assert.match(await target.innerText(),/Subir un comprobante no habilita/);
  assert.doesNotMatch(await target.innerText(),/sin pago previo/);
  assert.equal(await target.locator('[name="itemIds"][value="449"]').count(),0);
  assert.equal(await target.locator('[name="itemIds"][value="474"]').count(),1);
  const immediate=target.locator(kind==='admin'?'[data-admin-pickup-part="IMMEDIATE"]':'form[data-pickup-timing-key="IMMEDIATE"]');
  const select=immediate.locator('[name="slotKey"]');
  const selected=await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(selected);
  await immediate.locator('button[type="submit"]').click();
  await target.getByText(kind==='admin'?'Agendado:':'Horario confirmado:',{exact:false}).waitFor();
  assert.deepEqual(posts[0].itemIds,['381']);assert.equal(posts[0].expectedRevision,0);
  if(kind==='admin') {
    await target.locator('summary').click();
    const form=target.locator('[data-item-payment-decision]');
    await form.locator('[name="kind"]').selectOption('ALLOCATE');
    await form.locator('[name="productId"]').selectOption('449');
    await form.locator('[name="paymentId"]').selectOption('paid');
    await form.locator('[name="amountPYG"]').fill('100');
    await form.locator('[name="note"]').fill('Synthetic owner allocation from remaining confirmed funds');
    await form.locator('button[type="submit"]').click();
    await target.locator('[name="itemIds"][value="449"]').waitFor();
    assert.equal((await readItemPaymentDecisions(id)).filter(e=>e.kind==='ALLOCATE').length,3);
  }
  // The page becomes stale after an Admin reverses funding. A direct form
  // request is rejected under lock and the original appointment remains intact.
  await appendItemPaymentDecision(id,{kind:'REVERSE',reversesId:decision.id,note:'Synthetic reversal after page load'});
  const before=(await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[id])).rows;
  const replace=target.locator(kind==='admin'?'[data-admin-pickup-part="IMMEDIATE"]':'form[data-pickup-timing-key="IMMEDIATE"]');
  await replace.locator('button[type="submit"]').click();
  await replace.locator('[role="alert"]').waitFor({state:'visible'});
  assert.match(await replace.locator('[role="alert"]').innerText(),/Admin debe confirmar|únicamente artículos/);
  assert.deepEqual((await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[id])).rows,before);
  const open = await readPickupWriteControl();
  await setPickupWriteControl({id:randomUUID(),paused:true,expectedRevision:open.revision,reason:'Synthetic emergency pause'});
  // This form was rendered before containment was activated.
  await replace.locator('button[type="submit"]').click();
  await replace.locator('[role="alert"]').filter({hasText:'pausados'}).waitFor();
  assert.deepEqual((await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[id])).rows,before);
  const refresh = () => page.evaluate(async({order,kind}) => kind==='admin' ? setupAdminPickup(order) : setupPickupScheduler(order,'synthetic-access'),{order,kind});
  await refresh();
  assert.match(await target.innerText(),/pausad/);
  assert.equal(await target.locator('[data-admin-pickup-form], [data-pickup-timing-key], [data-admin-cancel-pickup]').count(),0);
  assert.match(await target.innerText(),/turno existente se conserva|horario existente se conserva/);
  if(kind==='admin') assert.equal(await target.locator('[data-item-payment-decision] button[type=submit]').isDisabled(),true);
  const paused = await readPickupWriteControl();
  await setPickupWriteControl({id:randomUUID(),paused:false,expectedRevision:paused.revision,reason:'Synthetic verified recovery'});
  await refresh();
  assert.ok(await target.locator('[data-admin-pickup-form], [data-pickup-timing-key]').count()>0);
  if(kind==='admin') assert.equal(await target.locator('[data-item-payment-decision] button[type=submit]').isDisabled(),false);
  const ledgerBeforeFull=await readItemPaymentDecisions(id);
  const appointmentsBeforeFull=(await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[id])).rows;
  const fullyPaid={...order,payments:[...order.payments,{id:'final',amountPYG:75,amountSource:'ADMIN_VERIFIED',verifiedBy:'ADMIN',verificationStatus:'CONFIRMED'}]};
  await db.query('UPDATE checkout_attempts SET order_snapshot=$2 WHERE order_id=$1',[id,JSON.stringify(fullyPaid)]);
  await refresh();
  assert.equal(await target.locator('[name="itemIds"][value="449"]').count(),1);
  assert.match(await target.innerText(),/Pago total del pedido confirmado|Cubierto por pago total del pedido/);
  assert.deepEqual((await db.query('SELECT * FROM pickup_appointments WHERE order_id=$1',[id])).rows,appointmentsBeforeFull);
  assert.deepEqual(await readItemPaymentDecisions(id),ledgerBeforeFull);
  const fullPart=target.locator(kind==='admin'?'[data-admin-pickup-part="IMMEDIATE"]':'form[data-pickup-timing-key="IMMEDIATE"]');
  await fullPart.locator('[name="itemIds"][value="449"]').check();
  const savedFull=page.waitForResponse(r=>new URL(r.url()).pathname===(kind==='admin'?'/api/admin/pickup':'/api/orders/pickup')&&r.request().method()==='POST'&&r.status()===200);
  await fullPart.locator('button[type="submit"]').click();
  await savedFull;
  assert.deepEqual(posts.at(-1).itemIds,['381','449']);
  assert.deepEqual(await readItemPaymentDecisions(id),ledgerBeforeFull);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  if(process.env.PICKUP_DEMO_OUTPUT_DIR){await mkdir(process.env.PICKUP_DEMO_OUTPUT_DIR,{recursive:true});await target.screenshot({path:path.join(process.env.PICKUP_DEMO_OUTPUT_DIR,`${kind}-${mobile?'mobile':'desktop'}-payment-enforcement.png`)});}
  assert.deepEqual(errors,[]);await page.close();
});

for(const mobile of [false,true]) test(`owner containment ${mobile?'mobile':'desktop'} confirms pause, records reason, refreshes before resume`,async()=>{
  const handler=createPickupContainmentHandler({authorized:r=>r.headers.get('x-admin-token')==='synthetic'});
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});
  page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/harness') return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${assets['css/site.css']}</style></head><body><main style="max-width:900px;margin:auto;padding:16px"><section id="admin-pickup-containment"></section></main></body></html>`});
    if(url.pathname==='/api/admin/pickup-containment'){
      const response=await handler(new Request(url,{method:request.method(),headers:request.headers(),body:request.method()==='POST'?request.postData():undefined}));
      return route.fulfill({status:response.status,json:await response.json()});
    }
    return route.abort();
  });
  await page.goto('https://pickup.test/harness');await page.addScriptTag({content:assets['js/admin.js']});await page.addScriptTag({content:assets['js/admin-retiros.js']});
  await page.evaluate(async()=>{ADMIN_STATE.token='synthetic';injectAdminStyles();await loadPickupContainment();});
  const target=page.locator('#admin-pickup-containment');assert.match(await target.innerText(),/ACTIVO/);
  await target.locator('textarea').fill('Synthetic containment owner reason');
  await target.getByRole('button',{name:'Pausar operaciones',exact:true}).click();
  await target.locator('[data-containment-result]').filter({hasText:'Pausa confirmada'}).waitFor().catch(async e=>{throw new Error(e.message+' UI: '+await target.innerText());});
  assert.equal((await readPickupWriteControl()).paused,true);
  assert.equal(await target.getByRole('button',{name:'Pausar operaciones',exact:true}).isDisabled(),true);
  await target.getByRole('button',{name:'Consultar estado',exact:true}).click();
  await target.getByRole('button',{name:'Reanudar operaciones',exact:true}).waitFor();
  await target.locator('summary').click();
  assert.match(await target.innerText(),/Synthetic containment owner reason/);
  await target.locator('textarea').fill('Synthetic recovery verified');
  await target.getByRole('button',{name:'Reanudar operaciones',exact:true}).click();
  await target.locator('[data-containment-result]').filter({hasText:'Reanudación confirmada'}).waitFor();
  assert.equal((await readPickupWriteControl()).paused,false);
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
});
