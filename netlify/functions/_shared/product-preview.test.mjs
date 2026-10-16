import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  projectPublicCatalog,
} from './commerce.mjs';
import {
  buildProductPreviewMetadata,
  injectProductPreviewMetadata,
  selectPreviewProduct,
} from './product-preview.mjs';

const shell = `<!doctype html>
<html>
<head>
  <meta property="og:title" content="Venta de Mudanza" />
  <meta property="og:description" content="Venta particular en Paraguay" />
  <meta property="og:image" content="/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Venta de Mudanza" />
  <meta name="twitter:image" content="/og.png" />
</head>
<body></body>
</html>`;

const item313 = {
  id: 'real-202610-volume3-313',
  itemNumber: 313,
  slug: 'ups-apc-easy-ups-srv2ki-de-2000-va-2-kva-1-6-kw-item-313',
  title: 'UPS APC Easy UPS SRV2KI de 2000 VA (2 kVA / 1,6 kW)',
  category: 'Electrónica',
  status: 'AVAILABLE',
  quantityRemaining: 1,
  images: [
    '/images/volume-3/PXL_20260926_194643111.jpg',
    '/images/volume-3/PXL_20260926_194623392.jpg',
  ],
};

function product(overrides = {}) {
  return {
    id: 'product-1',
    itemNumber: 1,
    slug: 'product-1',
    title: 'Producto 1',
    category: 'Hogar',
    status: 'AVAILABLE',
    quantityRemaining: 1,
    images: ['/images/product-1.jpg'],
    ...overrides,
  };
}

function deliveredRow(productId, overrides = {}) {
  return {
    order_id: 'order-1',
    product_id: productId,
    quantity: 1,
    fulfillment_batch_id: 'batch-1',
    batch_status: 'DELIVERED',
    merged_into_batch_id: null,
    ...overrides,
  };
}

test('product preview uses the real primary image and clean canonical URL', () => {
  assert.deepEqual(
    buildProductPreviewMetadata(item313, 'https://thelabossieres.com'),
    {
      title: item313.title,
      canonicalUrl:
        'https://thelabossieres.com/producto/ups-apc-easy-ups-srv2ki-de-2000-va-2-kva-1-6-kw-item-313',
      imageUrl:
        'https://thelabossieres.com/images/volume-3/PXL_20260926_194643111.jpg',
    }
  );
});

test('product preview replaces the generic social image without adding special marketing copy', () => {
  const html = injectProductPreviewMetadata(
    shell,
    item313,
    'https://thelabossieres.com'
  );

  assert.match(
    html,
    /property="og:image" content="https:\/\/thelabossieres\.com\/images\/volume-3\/PXL_20260926_194643111\.jpg"/
  );
  assert.match(
    html,
    /property="og:url" content="https:\/\/thelabossieres\.com\/producto\/ups-apc-easy-ups-srv2ki-de-2000-va-2-kva-1-6-kw-item-313"/
  );
  assert.match(
    html,
    /rel="canonical" href="https:\/\/thelabossieres\.com\/producto\/ups-apc-easy-ups-srv2ki-de-2000-va-2-kva-1-6-kw-item-313"/
  );
  assert.match(
    html,
    /name="twitter:card" content="summary_large_image"/
  );
  assert.match(
    html,
    /property="og:description" content="Venta particular en Paraguay"/
  );
  assert.doesNotMatch(
    html,
    /property="og:image" content="\/og\.png"/
  );
});

test('normal public product is eligible for product preview metadata', () => {
  const visible = product();
  const projected = projectPublicCatalog([visible], [], visible.slug);
  assert.equal(selectPreviewProduct(projected.products, visible.slug)?.id, visible.id);
});

test('UNLISTED product is not eligible for product preview metadata', () => {
  const hidden = product({ status: 'UNLISTED' });
  const projected = projectPublicCatalog([hidden], [], hidden.slug);
  assert.equal(selectPreviewProduct(projected.products, hidden.slug), null);
});

test('NEEDS_REVIEW product is not eligible for product preview metadata', () => {
  const hidden = product({ status: 'NEEDS_REVIEW' });
  const projected = projectPublicCatalog([hidden], [], hidden.slug);
  assert.equal(selectPreviewProduct(projected.products, hidden.slug), null);
});

test('fully delivered hidden product does not receive normal product-photo metadata', () => {
  const delivered = product({
    status: 'SOLD',
    quantityRemaining: 0,
  });
  const projected = projectPublicCatalog(
    [delivered],
    [deliveredRow(delivered.id)],
    delivered.slug
  );

  assert.equal(selectPreviewProduct(projected.products, delivered.slug), null);
  assert.equal(projected.deliveredProduct?.id, delivered.id);
});

test('normal SOLD product that remains public stays eligible for existing public behavior', () => {
  const soldPublic = product({
    status: 'SOLD',
    quantityRemaining: 0,
  });
  const projected = projectPublicCatalog([soldPublic], [], soldPublic.slug);

  assert.equal(
    selectPreviewProduct(projected.products, soldPublic.slug)?.id,
    soldPublic.id
  );
});

test('product routes are rewritten through the social-preview shell', async () => {
  const redirects = await readFile(
    new URL('../../../_redirects', import.meta.url),
    'utf8'
  );

  assert.match(
    redirects,
    /^\/producto\/\*\s+\/\.netlify\/functions\/product-page\?slug=:splat\s+200$/m
  );
  assert.doesNotMatch(
    redirects,
    /^\/producto\/\*\s+\/index\.html\s+200$/m
  );
});

test('product preview route consumes the established public catalog projection', async () => {
  const routeSource = await readFile(
    new URL('../product-page.mjs', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /loadPublicCatalog/);
  assert.match(routeSource, /requestedSlug:\s*slug/);
  assert.doesNotMatch(routeSource, /\bloadCatalog\b/);
});
