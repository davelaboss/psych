function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function removeMeta(html, attribute, value) {
  const escaped = String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const pattern = new RegExp(
    '<meta\\s+[^>]*' + attribute + '=["\\\']' + escaped + '["\\\'][^>]*>\\s*',
    'gi'
  );
  return html.replace(pattern, '');
}

function removeCanonical(html) {
  return html.replace(
    /<link\s+[^>]*rel=["']canonical["'][^>]*>\s*/gi,
    ''
  );
}

export function selectPreviewProduct(products, slug) {
  const wanted = String(slug || '').trim();

  if (!wanted) {
    return null;
  }

  return (Array.isArray(products) ? products : [])
    .find(product => product?.slug === wanted) || null;
}

export function deriveProductPreviewSlug(requestUrl) {
  const url = requestUrl instanceof URL
    ? requestUrl
    : new URL(String(requestUrl));
  const productPrefix = '/producto/';

  if (url.pathname.startsWith(productPrefix)) {
    const encodedSlug = url.pathname
      .slice(productPrefix.length)
      .replace(/\/+$/, '');

    if (encodedSlug) {
      try {
        return decodeURIComponent(encodedSlug).trim();
      } catch {
        // Fall through to the direct-function query fallback.
      }
    }
  }

  return String(url.searchParams.get('slug') || '').trim();
}

export function buildProductPreviewMetadata(product, origin) {
  const images = Array.isArray(product?.images) ? product.images : [];
  const primaryImage = images.find(Boolean) || '';

  if (!product?.slug || !product?.title || !primaryImage) {
    return null;
  }

  const source = new URL(primaryImage, origin);
  const site = new URL(origin);
  const image = source.origin === site.origin
    ? new URL('/.netlify/images', site)
    : source;

  if (image !== source) {
    image.searchParams.set('url', source.pathname + source.search);
    image.searchParams.set('w', '900');
    image.searchParams.set('h', '900');
    image.searchParams.set('fit', 'contain');
    image.searchParams.set('q', '70');
    image.searchParams.set('fm', 'jpg');
  }

  return {
    title: String(product.title).trim(),
    canonicalUrl: new URL(
      '/producto/' + encodeURIComponent(product.slug),
      origin
    ).toString(),
    imageUrl: image.toString(),
    imageType: image === source ? null : 'image/jpeg',
  };
}

export function injectProductPreviewMetadata(html, product, origin) {
  const metadata = buildProductPreviewMetadata(product, origin);

  if (!metadata || !String(html).includes('</head>')) {
    return html;
  }

  let next = String(html);

  for (const [attribute, value] of [
    ['property', 'og:title'],
    ['property', 'og:image'],
    ['property', 'og:image:width'],
    ['property', 'og:image:height'],
    ['property', 'og:image:alt'],
    ['property', 'og:image:type'],
    ['property', 'og:url'],
    ['name', 'twitter:title'],
    ['name', 'twitter:image'],
  ]) {
    next = removeMeta(next, attribute, value);
  }

  next = removeCanonical(next);

  const title = escapeAttribute(metadata.title);
  const canonicalUrl = escapeAttribute(metadata.canonicalUrl);
  const imageUrl = escapeAttribute(metadata.imageUrl);

  const tags = [
    '  <meta property="og:title" content="' + title + '" />',
    '  <meta property="og:image" content="' + imageUrl + '" />',
    ...(metadata.imageType
      ? ['  <meta property="og:image:type" content="' + metadata.imageType + '" />']
      : []),
    '  <meta property="og:url" content="' + canonicalUrl + '" />',
    '  <meta name="twitter:title" content="' + title + '" />',
    '  <meta name="twitter:image" content="' + imageUrl + '" />',
    '  <link rel="canonical" href="' + canonicalUrl + '" />',
  ].join('\n');

  return next.replace('</head>', tags + '\n</head>');
}
