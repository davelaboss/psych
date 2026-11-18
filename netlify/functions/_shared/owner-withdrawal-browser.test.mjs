import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const source=await readFile(new URL('../../../js/admin.js',import.meta.url),'utf8');
const css=await readFile(new URL('../../../css/site.css',import.meta.url),'utf8');
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true})});
test.after(async()=>{await browser.close()});
for(const mobile of [false,true]) test(`withdrawal ${mobile?'mobile':'desktop'} confirmation, commitment error, success and retained history`,async()=>{
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});
 const p={id:'synthetic',itemNumber:999,title:'Synthetic Item',images:['/original.webp'],description:'Original description',
   live:{id:'synthetic',status:'AVAILABLE',quantityRemaining:1},published:true,quantityTotal:1,quantityRemaining:1,askingPricePYG:100};
 let calls=0,block=true;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
   if(new URL(route.request().url()).pathname==='/api/admin/withdraw-product'){
     calls++;assert.deepEqual(route.request().postDataJSON(),{productId:p.id,confirmed:true});
     return route.fulfill({status:block?409:200,json:block?{error:'No se retiró el artículo: tiene compromisos en VM-SYNTHETIC.'}:
       {ok:true,withdrawal:{actor:'OWNER',recordedAt:'2026-11-15T12:00:00Z'},message:'Artículo retirado de la venta. No se registró una venta ni una entrega. Su ficha, fotos e historial se conservan.'}});
   }
   return route.fulfill({contentType:'text/html',body:`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main style="max-width:1000px;margin:auto;padding:16px"></main></html>`});
 });
 await page.goto('https://isolated.test/harness');await page.addScriptTag({content:source});
 await page.evaluate(p=>{ADMIN_STATE.token='synthetic';injectAdminStyles();const main=document.querySelector('main');main.innerHTML=renderLegacyProductDetail(p);bindAdminProductEditor(p,main)},p);
 const button=page.locator('[data-withdraw-product]');
 page.once('dialog',d=>d.dismiss());await button.click();assert.equal(calls,0);
 page.once('dialog',d=>d.accept());await button.click();await page.getByText('No se retiró el artículo:',{exact:false}).waitFor();
 assert.equal(await button.isEnabled(),true);assert.equal(calls,1);
 block=false;page.once('dialog',d=>d.accept());await button.click();await page.getByText('Artículo retirado de la venta.',{exact:false}).waitFor();
 assert.equal(await button.isDisabled(),true);assert.equal(calls,2);
 assert.match(await button.innerText(),/NO LONGER FOR SALE/);assert.equal(await page.locator('[data-photo-delete]').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);await page.close();
});
