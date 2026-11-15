import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {PGlite} from '@electric-sql/pglite';
import sessionHandler from '../admin-session.mjs';
import {adminAuthorized} from './admin-sessions.mjs';
import {setInventoryDatabaseClientForTests} from './inventory-database.mjs';

const source=await readFile(new URL('../../../js/admin.js',import.meta.url),'utf8');
const css=await readFile(new URL('../../../css/site.css',import.meta.url),'utf8');
const origin='https://isolated.test',credential='synthetic-browser-owner';
let db;const previous=process.env.ADMIN_TOKEN;
test.before(async()=>{
 db=new PGlite();await db.exec(await readFile(new URL('../../database/migrations/20261117_admin_sessions.sql',import.meta.url),'utf8'));
 setInventoryDatabaseClientForTests({pool:{query:(...a)=>db.query(...a)}});process.env.ADMIN_TOKEN=credential;
});
test.after(async()=>{setInventoryDatabaseClientForTests(undefined);if(previous===undefined)delete process.env.ADMIN_TOKEN;else process.env.ADMIN_TOKEN=previous;await db.close()});

async function routes(context,events){
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.startsWith('/api/admin/')){
   const request=new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(req.postData()?{body:req.postData()}:{})});
   if(url.pathname==='/api/admin/session'){
    events.push({method:req.method(),body:req.postDataJSON?.()});
    const response=await sessionHandler(request);
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
   }
   if(!await adminAuthorized(request))return route.fulfill({status:401,json:{error:'Acceso no autorizado.'}});
   return route.fulfill({json:{orders:[],products:[],batches:[],buyerGroups:[],fulfillmentBatches:[],salePulse:null}});
  }
  return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main></main></body></html>`});
 });
}
async function boot(context,page){
 page ||= await context.newPage();
 await page.goto(origin+'/admin');await page.addScriptTag({content:source});
 await page.evaluate(async()=>{
  renderAdminTab=()=>{document.querySelector('#admin-tab-content').textContent='Synthetic Admin dashboard'};
  await renderAdmin();
 });return page;
}
for(const mobile of [false,true])for(const remember of [false,true])test(`${mobile?'mobile':'desktop'} ${remember?'30-day':'12-hour'} login survives new tab, refresh and real browser restart; logout revokes`,async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'psych-session-test-'));
 const viewport=mobile?{width:390,height:844}:{width:1440,height:1000};
 const events=[],errors=[];let context;
 try{
  context=await chromium.launchPersistentContext(dir,{headless:true,viewport});await routes(context,events);
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const page=await boot(context);
  assert.equal(await page.getByText('Mantener sesión iniciada',{exact:true}).count(),1);
  await page.locator('[name="token"]').fill(credential);if(remember)await page.locator('[name="rememberMe"]').check();
  await page.locator('#admin-login button[type="submit"]').click();await page.getByText('Synthetic Admin dashboard').waitFor();
  assert.equal(events.filter(e=>e.body?.action==='login').length,1);
  assert.equal(events.find(e=>e.body?.action==='login').body.rememberMe,remember);
  assert.deepEqual(await page.evaluate(()=>({session:sessionStorage.getItem('mudanza-admin-token'),local:localStorage.getItem('mudanza-admin-token'),visibleCookie:document.cookie})),{session:null,local:null,visibleCookie:''});
  const cookies=await context.cookies(origin);assert.equal(cookies.length,1);assert.equal(cookies[0].httpOnly,true);assert.equal(cookies[0].secure,true);assert.equal(cookies[0].sameSite,'Strict');
  const second=await boot(context);await second.getByText('Synthetic Admin dashboard').waitFor();
  await boot(context,page);await page.getByText('Synthetic Admin dashboard').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const savedCookie=cookies[0].name+'='+cookies[0].value;
  // Close the actual Chromium process, then reopen the same disposable profile.
  await context.close();context=await chromium.launchPersistentContext(dir,{headless:true,viewport});await routes(context,events);
  const reopened=await boot(context);await reopened.getByText('Synthetic Admin dashboard').waitFor();
  assert.equal(events.filter(e=>e.body?.action==='login').length,1,'restart must not require another login');
  await reopened.locator('#admin-logout').click();await reopened.locator('#admin-login').waitFor();
  assert.equal(await adminAuthorized(new Request(origin+'/api/admin/orders',{headers:{cookie:savedCookie}})),false);
  assert.equal((await context.cookies(origin)).length,0);
  await boot(context,reopened);await reopened.locator('#admin-login').waitFor();assert.deepEqual(errors,[]);
 }finally{if(context)await context.close();assert.ok(path.isAbsolute(dir)&&dir.startsWith(path.join(os.tmpdir(),'psych-session-test-')));await rm(dir,{recursive:true,force:true})}
});

test('old per-tab credential is removed and migration requires one login; temporary session check failure stays retryable',async()=>{
 const browser=await chromium.launch({headless:true}),context=await browser.newContext();const events=[];
 try{
  await routes(context,events);const page=await context.newPage();await page.goto(origin+'/admin');
  await page.evaluate(token=>sessionStorage.setItem('mudanza-admin-token',token),credential);
  await page.addScriptTag({content:source});await page.evaluate(()=>renderAdmin());await page.locator('#admin-login').waitFor();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('mudanza-admin-token')),null);
  assert.equal(events.some(e=>e.body?.token===credential),false,'must not silently reuse the former plaintext credential');
  await context.route('**/api/admin/session',route=>route.fulfill({status:503,json:{error:'Temporary service failure'}}));
  await page.evaluate(()=>renderAdmin());await page.getByRole('button',{name:'Reintentar',exact:true}).waitFor();
  assert.equal(await page.locator('#admin-login').count(),0);
 }finally{await browser.close()}
});
