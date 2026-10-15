import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildProductPreviewMetadata,
  injectProductPreviewMetadata,
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
  slug: 'ups-apc-easy-ups-srv2ki-de-2000-va-2-kva-1-6-kw-item-313',
  title: 'UPS APC Easy UPS SRV2KI de 2000 VA (2 kVA / 1,6 kW)',
  images: [
    '/images/volume-3/PXL_20260926_194643111.jpg',
    '/images/volume-3/PXL_20260926_194623392.jpg',
  ],
};

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
