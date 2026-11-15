import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setInventoryDatabaseClientForTests} from './inventory-database.mjs';
import {adminAuthorized,ADMIN_COOKIE,STANDARD_SECONDS,REMEMBER_SECONDS,readAdminSession} from './admin-sessions.mjs';
import handler from '../admin-session.mjs';
import {createItemPaymentHandler} from '../admin-item-payment.mjs';
import {createPickupContainmentHandler} from '../admin-pickup-containment.mjs';

let db;const previous=process.env.ADMIN_TOKEN;
const origin='https://isolated.test',credential='synthetic-owner-secret';
const request=(body,cookie='',extra={})=>new Request(origin+'/api/admin/session',{
 method:body?'POST':'GET',headers:{origin,cookie,'content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});
const login=async rememberMe=>handler(request({action:'login',token:credential,rememberMe}));
const cookie=response=>response.headers.get('set-cookie').split(';')[0];
test.before(async()=>{db=new PGlite();await db.exec(await readFile(new URL('../../database/migrations/20261115_admin_sessions.sql',import.meta.url),'utf8'));
 setInventoryDatabaseClientForTests({pool:{query:(...a)=>db.query(...a)}});process.env.ADMIN_TOKEN=credential;});
test.after(async()=>{setInventoryDatabaseClientForTests(undefined);if(previous===undefined)delete process.env.ADMIN_TOKEN;else process.env.ADMIN_TOKEN=previous;await db.close()});

for(const remember of [false,true])test(`${remember?'remembered':'standard'} session has exact bounded lifetime and a secure opaque cookie`,async()=>{
 const response=await login(remember),seconds=remember?REMEMBER_SECONDS:STANDARD_SECONDS;
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const header=response.headers.get('set-cookie');assert.match(header,/^__Host-psych_admin_session=[A-Za-z0-9_-]{43};/);
 for(const flag of ['Path=/','Secure','HttpOnly','SameSite=Strict',`Max-Age=${seconds}`])assert.ok(header.includes(flag));
 assert.ok(!header.includes(credential));assert.ok(!header.includes('Domain='));
 const body=await response.json();assert.equal(body.session.role,'OWNER');assert.equal(body.session.rememberMe,remember);
 assert.equal(Object.hasOwn(body,'token'),false);
 const raw=cookie(response).split('=')[1],hash=createHash('sha256').update(raw).digest('hex');
 const row=(await db.query('SELECT *,extract(epoch FROM (expires_at-created_at)) AS lifetime FROM admin_sessions WHERE token_hash=$1',[hash])).rows[0];
 assert.ok(Math.abs(Number(row.lifetime)-seconds)<1);assert.notEqual(row.token_hash,raw);assert.ok(!JSON.stringify(row).includes(credential));
 const before=(await db.query('SELECT * FROM admin_sessions WHERE token_hash=$1',[hash])).rows;
 assert.equal(await adminAuthorized(request(null,cookie(response))),true);assert.equal((await handler(request(null,cookie(response)))).status,200);
 assert.deepEqual((await db.query('SELECT * FROM admin_sessions WHERE token_hash=$1',[hash])).rows,before,'reads must not extend expiry');
 await db.query("UPDATE admin_sessions SET created_at=clock_timestamp()-interval '31 days',expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[hash]);
 assert.equal(await adminAuthorized(request(null,cookie(response))),false);
 assert.equal((await handler(request(null,cookie(response)))).status,401);
});

test('logout revokes the server row and clears the browser cookie; replay fails',async()=>{
 const response=await login(true),c=cookie(response);
 assert.equal(await adminAuthorized(request(null,c)),true);
 const out=await handler(request({action:'logout'},c));assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal(await adminAuthorized(request(null,c)),false);
 assert.equal((await handler(request({action:'logout'}))).status,200,'idempotent logout');
});

test('owner can revoke every active device without changing the credential or customer state',async()=>{
 const a=cookie(await login(true)),b=cookie(await login(false));
 assert.equal((await handler(request({action:'revoke-all'},a))).status,200);
 assert.equal(await adminAuthorized(request(null,a)),false);assert.equal(await adminAuthorized(request(null,b)),false);
 assert.equal(process.env.ADMIN_TOKEN,credential);
 assert.equal((await login(false)).status,200);
});

test('credential rotation immediately revokes old sessions without trusting client roles',async()=>{
 const c=cookie(await login(true));process.env.ADMIN_TOKEN='rotated-synthetic-owner';
 assert.equal(await adminAuthorized(request(null,c)),false);process.env.ADMIN_TOKEN=credential;
 assert.equal((await handler(request({action:'login',token:'reviewer'},'',{'x-admin-role':'OWNER'}))).status,401);
 assert.equal(await adminAuthorized(request(null,'mudanza_reviewer_session=synthetic')),false);
 assert.equal(await adminAuthorized(request(null,'',{'x-admin-token':credential,'x-admin-role':'REVIEWER'})),true,'server credential identifies OWNER; client role is ignored');
});

test('cookie-authenticated mutations reject missing/foreign origin and sibling-site requests',async()=>{
 const c=cookie(await login(true));
 for(const headers of [{origin:'https://other.test'},{origin:'null'},{origin:'https://sibling.isolated.test'},{origin,'sec-fetch-site':'same-site'}]){
  assert.equal(await adminAuthorized(request(null,c,headers)),false);
  assert.equal((await handler(request(null,c,headers))).status,401);
  assert.equal(await adminAuthorized(request({action:'sensitive'},c,headers)),false);
  assert.equal((await handler(request({action:'logout'},c,headers))).status,403);
  assert.equal((await handler(request({action:'login',token:credential},'',headers))).status,403);
 }
 const noOrigin=new Request(origin+'/api/admin/session',{method:'POST',headers:{cookie:c},body:JSON.stringify({action:'logout'})});
 assert.equal((await handler(noOrigin)).status,403);
 assert.equal(await adminAuthorized(request({action:'sensitive'},c)),true);
 assert.equal(await adminAuthorized(request(null,c+'; '+c)),false,'duplicate cookies fail closed');
 assert.equal(await adminAuthorized(request(null,ADMIN_COOKIE+'=malformed')),false);
});

test('every deployed Admin handler rejects unauthenticated access before reading or mutating business data',async()=>{
 const files=(await readdir(new URL('../',import.meta.url))).filter(f=>f.startsWith('admin-')&&f.endsWith('.mjs')&&f!=='admin-session.mjs');
 for(const f of files){
  const {default:admin}=await import(new URL('../'+f,import.meta.url));
  for(const method of ['GET','POST'])assert.equal((await admin(new Request(origin+'/.netlify/functions/'+f.slice(0,-4),{method}))).status,401,f+' '+method);
 }
});

test('sensitive injected authorization checks await denial rather than treating a Promise as permission',async()=>{
 for(const make of [createItemPaymentHandler,createPickupContainmentHandler]){
  const fn=make({authorized:async()=>false});assert.equal((await fn(request({action:'sensitive'}))).status,401);
 }
});

test('database outage fails closed and does not clear a still-valid browser cookie',async()=>{
 const c=cookie(await login(true));setInventoryDatabaseClientForTests({pool:{query:async()=>{throw Error('synthetic outage')}}});
 const response=await handler(request(null,c));assert.equal(response.status,503);assert.equal(response.headers.get('set-cookie'),null);
 setInventoryDatabaseClientForTests({pool:{query:(...a)=>db.query(...a)}});assert.equal((await handler(request(null,c))).status,200);
});
