import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { acceptable, deliveryUrl, inspect, sourceKey } from '../../../tools/image-delivery/verify.mjs';
import { optimizeMarkup } from '../../../tools/image-delivery/sync-markup.mjs';
import { buildProductPreviewMetadata } from './product-preview.mjs';

const resolverSource = await fs.readFile('js/image-delivery.js', 'utf8');
const site = await fs.readFile('js/site.js', 'utf8');
const controller = await fs.readFile('js/volume2-storefront.js', 'utf8');
const html = await fs.readFile('index.html', 'utf8');
function delivery(manifest = { '/photo.jpg': ['small', 'medium'] }) {
  let onError;
  const context = { URL, URLSearchParams, window: { location: { origin: 'https://shop.test' }, __imageDeliveryManifest: manifest }, document: { addEventListener: (name, cb) => { if (name === 'error') onError = cb; } } };
  vm.runInNewContext(resolverSource, context);
  return { ...context.window.imageDelivery, onError };
}
const imageDelivery = delivery();
const product = Object.freeze({ id: 'one', slug: 'one', itemNumber: 1, title: 'Chair', description: 'Used chair', category: 'Hogar', images: Object.freeze(['photo.jpg', 'unknown.jpg']), status: 'AVAILABLE', saleMode: 'IMMEDIATE', askingPricePYG: 100, quantityTotal: 1, quantityRemaining: 1 });
function extract(source, start, end) { return source.slice(source.indexOf('function ' + start), source.indexOf('function ' + end, source.indexOf('function ' + start))); }
function renderDetail(p = product) {
  const main = {};
  const context = { window: { imageDelivery, dispatchEvent() {} }, document: { querySelector: () => main, body: { classList: { add() {} }, dataset: {} }, documentElement: { classList: { remove() {} } } }, CustomEvent: class {}, formatPYG: String, dueNowForProduct: () => 100, buildProductDiscovery: () => ({}), renderProductSequenceLink: () => '', publicConditionText: () => '', publicKnownDefectText: () => '', escapeHtml: String, formatPickupWindow: () => '', buildWhatsAppProductShareHref: () => '', setupProductCartButton() {}, setupProductDiscoveryKeyboard() {}, setupRelatedProductsCarousel() {} };
  vm.runInNewContext(extract(site, 'renderProductDetail', 'renderCartPage') + ';renderProductDetail(product)', { ...context, product: p });
  return main.innerHTML;
}
test('known card and detail sizes resolve to verified proportional CDN sources', () => {
  for (const [size, pixels] of [['small',720],['medium',1440]]) {
    const url = new URL(imageDelivery.resolve('photo.jpg', size), 'https://shop.test');
    assert.equal(url.pathname, '/.netlify/images');
    assert.equal(url.searchParams.get('w'), String(pixels));
    assert.equal(url.searchParams.get('h'), String(pixels));
    assert.equal(url.searchParams.get('fit'), 'contain');
    assert.equal(url.searchParams.get('url'), '/photo.jpg');
  }
});
test('missing derivative and newly uploaded Blob photos fall back to canonical sources', () => {
  for (const src of ['/unknown.jpg','/.netlify/functions/product-photo?key=new%2Fphoto']) assert.equal(imageDelivery.resolve(src), 'https://shop.test' + src);
  assert.equal(delivery({}).resolve('/photo.jpg'), 'https://shop.test/photo.jpg');
});
test('external images and invalid sizes use original without a same-origin prefix', () => {
  assert.equal(imageDelivery.resolve('https://cdn.test/photo.jpg'), 'https://cdn.test/photo.jpg');
  assert.equal(imageDelivery.resolve('/photo.jpg', 'huge'), 'https://shop.test/photo.jpg');
  assert.equal(imageDelivery.resolve(''), '');
  assert.equal(imageDelivery.resolve('http://['), 'http://[');
});
test('cache-busting v resolves but stays in the actual CDN source request', () => {
  const result = new URL(imageDelivery.resolve('/photo.jpg?v=2'), 'https://shop.test');
  assert.equal(result.searchParams.get('url'), '/photo.jpg?v=2');
  assert.equal(sourceKey('/photo.jpg?v=2'), '/photo.jpg');
  assert.equal(imageDelivery.resolve('/photo.jpg?variant=other'), 'https://shop.test/photo.jpg?variant=other');
});
test('Blob identity queries remain distinct and escaped once per URL layer', () => {
  const key = '/.netlify/functions/product-photo?key=item%2Ffirst';
  const d = delivery({ [key]: ['small'] });
  assert.equal(new URL(d.resolve(key), 'https://shop.test').searchParams.get('url'), key);
  assert.equal(d.resolve(key.replace('first', 'second')), 'https://shop.test' + key.replace('first','second'));
  assert.equal(sourceKey(key + '&v=2'), key);
});
test('CDN image failure retries original once and removes responsive candidates', () => {
  const img = { tagName: 'IMG', dataset: {}, getAttribute: () => '/photo.jpg?v=2', removeAttribute(name) { this.removed = name; } };
  imageDelivery.onError({ target: img });
  assert.equal(img.src, 'https://shop.test/photo.jpg?v=2');
  assert.equal(img.removed, 'srcset');
  img.src = 'sentinel'; imageDelivery.onError({ target: img }); assert.equal(img.src,'sentinel');
});
test('catalog cards use small images, preserve lazy loading, sold state and canonical data', () => {
  const article = { dataset: {} };
  const context = { document: { createElement: () => article }, window: { imageDelivery }, escapeAttr: String, escapeHtml: String, formatMoney: String, product: { ...product, status: 'SOLD' } };
  vm.runInNewContext(extract(controller,'renderCard','conditionBucket') + ';renderCard(product)', context);
  assert.match(article.innerHTML, /\/\.netlify\/images\?/);
  assert.match(article.innerHTML, /loading="lazy" decoding="async"/);
  assert.match(article.innerHTML, /sold-ribbon/);
  assert.match(article.innerHTML, /data-cart-action disabled/);
  assert.deepEqual(product.images,['photo.jpg','unknown.jpg']);
});
test('cart uses small delivery source and retains product link and original fallback', () => {
  const render = Function('window','getCartQuantity','dueNowForProduct','escapeHtml','formatPYG', extract(site,'renderCartItem','setupCartPageEvents') + '; return renderCartItem;')({imageDelivery},()=>1,()=>100,String,String);
  const result = render(product);
  assert.match(result, /src="\/\.netlify\/images\?/);
  assert.match(result, /data-original-src="https:\/\/shop.test\/photo.jpg"/);
  assert.match(result, /href="\/producto\/one"/);
});
test('product teaser and gallery thumbnails use small sources, main uses medium', () => {
  const result = renderDetail();
  const main = result.match(/id="main-product-image"[\s\S]*?>/)[0];
  assert.match(main, /w=1440/);
  assert.match(main, /data-original-src="https:\/\/shop.test\/photo.jpg"/);
  const teaser = result.slice(result.indexOf('product-photo-teaser-grid'),result.indexOf('product-price-block'));
  assert.match(teaser, /w=720/);
  assert.match(result, /data-photo-index="0"[\s\S]*?w=720/);
  assert.match(result, /src="https:\/\/shop.test\/unknown.jpg"/);
  assert.deepEqual(product.images,['photo.jpg','unknown.jpg']);
});
test('sold detail preserves photo inspection and disabled buying behavior', () => {
  const result = renderDetail({ ...product, status: 'SOLD' });
  assert.match(result, /VENDIDO/);
  assert.match(result, /id="product-cart-button"[\s\S]*?disabled/);
  assert.match(result, /data-original-src=/);
});
test('lightbox opens original URLs in gallery order at the clicked thumbnail index', () => {
  const img = src => ({ getAttribute: name => name === 'data-original-src' ? '/'+src : '/.netlify/images?'+src });
  const gallery = [img('photo.jpg'),img('photo.jpg'),img('second.jpg')];
  const trigger = { querySelector: () => img('second.jpg') };
  let click, opened;
  const context = { document: { addEventListener: (_name, cb) => {click=cb;}, querySelectorAll: () => gallery }, withLeadingSlash: s => s.startsWith('/')?s:'/'+s, createLightbox: (...args) => {opened=args;} };
  vm.runInNewContext(extract(controller,'installDetailLightbox','createLightbox') + ';installDetailLightbox()', context);
  click({ target: { closest: () => trigger }, preventDefault() {}, stopImmediatePropagation() {} });
  assert.deepEqual(Array.from(opened[0]),['/photo.jpg','/second.jpg']);
  assert.equal(opened[1],1); assert.equal(opened[2].opener,trigger);
});
test('lightbox thumbnails use small delivery URLs while active image uses original', () => {
  const source = extract(controller,'createLightbox','withLeadingSlash');
  assert.match(source, /src="\$\{escapeAttr\(window.imageDelivery.resolve\(src\)\)\}"/);
  assert.match(source, /image\.src\s*=\s*clean\[index\]/);
});
test('brand display URLs are small while original remains available', () => {
  const tags = [...html.matchAll(/<img\b[^>]*class="brand-photo"[^>]*>/g)].map(m=>m[0]);
  assert.equal(tags.length,2);
  for (const tag of tags) { assert.match(tag,/src="\/\.netlify\/images\?/); assert.match(tag,/w=252/); assert.match(tag,/data-original-src="\/assets\/media\/maria-david-luciano.png"/); }
});
test('social preview retains full canonical image rather than card delivery URL', () => {
  const metadata = buildProductPreviewMetadata(product, 'https://shop.test');
  assert.equal(metadata.imageUrl,'https://shop.test/photo.jpg');
});
test('verification rejects larger responses, crops, distortions and upscales', () => {
  const source={width:1000,height:500,bytes:10000,opaque:true};
  assert.ok(acceptable(source,{width:720,height:360,bytes:1000},720));
  for(const delivered of [{width:720,height:360,bytes:10001},{width:720,height:720,bytes:1000},{width:1440,height:720,bytes:1000}]) assert.equal(acceptable(source,delivered,720),false);
  assert.equal(acceptable({...source,opaque:false},{width:720,height:360,bytes:1000,opaque:true},720),false);
});
test('verification honors EXIF orientation and transparent images', async () => {
  const jpeg=await sharp({create:{width:40,height:20,channels:3,background:'red'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const result=await inspect(jpeg);assert.equal(result.width,20);assert.equal(result.height,40);
  const png=await sharp({create:{width:40,height:20,channels:4,background:{r:1,g:2,b:3,alpha:0.5}}}).png().toBuffer();
  assert.equal((await inspect(png)).opaque,false);
});
test('CDN verifier and browser agree on delivery parameters', () => {
  assert.equal(imageDelivery.resolve('/photo.jpg?v=2'),deliveryUrl('/photo.jpg?v=2',720));
});
test('embedded catalog canonical image references remain identical to the approved base', async () => {
  const commerce = await fs.readFile('netlify/functions/_shared/commerce.mjs','utf8');
  const parse = Function(commerce.slice(commerce.indexOf('function parseEmbeddedCatalog('),commerce.indexOf('export async function loadBaseCatalog'))+';return parseEmbeddedCatalog')();
  const refs = parse(html).map(p=>[p.id,p.images]);
  assert.equal(createHash('sha256').update(JSON.stringify(refs)).digest('hex'),'f5699f7581bcf58802fc0d4d59c6bb23e83aa25ac218be77a4d6301c84206ae5');
});
test('all verified static image sources remain present as independent original files', async () => {
  const context = {window:{}};
  vm.runInNewContext(await fs.readFile('js/image-delivery-manifest.js','utf8'),context);
  for(const key of Object.keys(context.window.__imageDeliveryManifest)) {
    if(key.startsWith('/.netlify/'))continue;
    await fs.access('.'+decodeURIComponent(new URL(key,'https://shop.test').pathname));
  }
});
test('every embedded CDN image retains original fallback and lazy card loading', () => {
  for(const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    if(!tag.includes('/.netlify/images?'))continue;
    assert.match(tag,/data-original-src="(?!\/\.netlify\/images)[^"]+"/);
    if(!tag.includes('class="brand-photo"'))assert.match(tag,/loading="lazy"/);
  }
});
test('markup refresh is repeatable and never rewrites original fallback or product data', () => {
  const source = '<img src="photo.jpg?v=2" loading="lazy" /><script>{"images":["photo.jpg?v=2"]}</script>';
  const manifest = {'/photo.jpg':['small']};
  const first = optimizeMarkup(source,manifest);
  assert.equal(optimizeMarkup(first,manifest),first);
  assert.match(first,/data-original-src="\/photo.jpg\?v=2"/);
  assert.match(first,/<script>\{"images":\["photo.jpg\?v=2"\]\}<\/script>/);
  assert.match(optimizeMarkup(first,{}),/ src="\/photo.jpg\?v=2"/);
});
