import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { VOLUME6_REMAINING } from '../../../source/lib/volume6-remaining.mjs';
import { publicProduct, catalogBatchProducts } from './volume2-public.mjs';

const products=VOLUME6_REMAINING.filter(p=>p.itemNumber>=661).map(publicProduct);
const byNumber=n=>products.find(p=>p.itemNumber===n);

test('six final approvals preserve prices and one-lot selling units through public projection',()=>{
 assert.deepEqual(products.map(p=>p.itemNumber),[661,662,663,664,665,666]);
 assert.deepEqual(products.map(p=>p.askingPricePYG),[4000,30000,22000,6000,2000,15000]);
 for(const p of products){assert.equal(p.quantityTotal,1);assert.equal(p.quantityRemaining,1);assert.equal(p.saleStructure,'set');assert.equal(p.saleMode,'IMMEDIATE');assert.equal(p.depositPercent,100);assert.equal(p.status,'AVAILABLE');assert.doesNotMatch(JSON.stringify(p),/a confirmar|revisar cierres|ownerPatch|sourceEvidence|NEEDS_REVIEW/);}
 assert.match(byNumber(661).description,/dos organizadores juntos.*4.000 en total/);assert.equal(byNumber(661).measurements,'Para platos pequeños de 17 cm.');
 assert.deepEqual(byNumber(662).includedAccessories,['Productos de limpieza para auto','Paños','Accesorio de microfibra']);assert.doesNotMatch(byNumber(662).description,/\d+\s*(botellas|paños|envases)/);assert.match(byNumber(662).condition,/contenido parcial/);
 assert.match(byNumber(664).description,/livianas.*No son para llaves ni cortinas/);assert.match(byNumber(664).functionality,/cierran correctamente/);
 assert.match(byNumber(665).description,/broches.*madera y plástico/);assert.match(byNumber(665).functionality,/resortes en buen estado/);
});

test('G021 is an approximate hanger lot, distinct from clothes clips, with no invented condition',()=>{
 const p=byNumber(663);assert.match(p.description,/aproximadamente 15–20/);assert.match(p.description,/conteo exacto no está establecido/);assert.match(p.description,/Aproximadamente 7.*antideslizante/);assert.match(p.description,/todo el lote, no a cada percha/);assert.equal(p.condition,'');assert.equal(p.knownDefects,'');assert.equal(p.functionality,'');assert.doesNotMatch(p.description,/buen estado|sin defectos|broches/);
});

test('G030 includes only four old/stretched cords and keeps the authorized old photograph unchanged',async()=>{
 const p=byNumber(666);assert.match(p.description,/fotografía es anterior/);assert.match(p.description,/ÚNICAMENTE 4 cuerdas: 2 antiguas y 2 estiradas/);assert.match(p.description,/otra cuerda.*NO está incluida/);assert.match(p.notIncludedVisible,/NO se incluye ninguna otra cuerda/);assert.equal(p.condition,'Dos cuerdas antiguas y dos estiradas.');assert.equal(p.knownDefects,'Dos cuerdas están estiradas.');assert.equal(p.functionality,'');assert.deepEqual(p.images,['/images/volume-6/v6-g0030-01.webp']);
 const file=await readFile(new URL('../../../images/volume-6/v6-g0030-01.webp',import.meta.url));assert.equal(createHash('sha256').update(file).digest('hex'),'600417a0ca264072484edaac47024324704fc5fbb8220962c844748b691d9ad2');
});

test('current production source including Tracker and Item 660 is preserved, with exactly six additions',async()=>{
 const text=execFileSync('git',['show','7eb458041b43c771750742ce7c30724bcb5aa1a5:source/lib/volume6-remaining.mjs'],{encoding:'utf8'});const previous=JSON.parse(text.split('Object.freeze(')[1].trim().slice(0,-2));assert.deepEqual(VOLUME6_REMAINING.filter(p=>p.itemNumber<661),previous);assert.equal(VOLUME6_REMAINING.length,previous.length+6);
 const catalog=catalogBatchProducts();for(const key of ['id','itemNumber','slug'])assert.equal(new Set(catalog.map(p=>p[key])).size,catalog.length);
 for(const p of products)for(const image of p.images)assert((await readFile(new URL('../../../'+image.slice(1),import.meta.url))).length>0);
});
