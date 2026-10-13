import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controller = readFileSync('js/volume2-storefront.js', 'utf8');
const staticStorefront = readFileSync('js/site.js', 'utf8');
const styles = readFileSync('css/site.css', 'utf8');

const renderCard = controller.slice(
  controller.indexOf('function renderCard(product)'),
  controller.indexOf('function conditionBucket(product)')
);

test('catalog cards use one full-card detail link without a photo control', () => {
  assert.match(renderCard, /class="product-card-link"/);
  assert.match(renderCard, /data-product-card-link/);
  assert.match(renderCard, /aria-label="Ver detalles de/);
  assert.doesNotMatch(renderCard, /data-photo-action/);
  assert.doesNotMatch(renderCard, /image-enlarge-hint/);
  assert.doesNotMatch(renderCard, /<button class="product-photo"/);
});

test('cart action remains an independent control and stops card navigation', () => {
  assert.match(renderCard, /<button type="button" data-cart-action/);
  assert.match(controller, /const cartButton = event\.target\.closest\('\[data-cart-action\]'\);/);
  assert.match(controller, /if \(cartButton\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?addStaticCartItem\(product\.id\)/);
});

test('server-rendered cards receive the same navigation model before catalog refresh', () => {
  assert.match(staticStorefront, /function enhanceCatalogCardNavigation\(/);
  assert.match(staticStorefront, /photoButton\.replaceWith\(photoSurface\)/);
  assert.match(staticStorefront, /card\.querySelectorAll\('\.image-enlarge-hint'\)/);
  assert.match(staticStorefront, /cardLink\.className = 'product-card-link'/);
  assert.match(staticStorefront, /enhanceCatalogCardNavigation\(card, productLink, product\)/);
});

test('full-card and cart focus layers are styled independently', () => {
  assert.match(styles, /\.product-card-link\{position:absolute;inset:0;z-index:1/);
  assert.match(styles, /\.product-card-link:focus-visible\{outline:3px solid var\(--clay\)/);
  assert.match(styles, /\.product-card \.card-actions\{position:relative;z-index:2\}/);
  assert.match(styles, /\.product-card \.image-enlarge-hint\{display:none!important\}/);
});
