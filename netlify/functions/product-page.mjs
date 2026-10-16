import { loadPublicCatalog } from './_shared/commerce.mjs';
import {
  injectProductPreviewMetadata,
  selectPreviewProduct,
} from './_shared/product-preview.mjs';

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
}

export default async function handler(request) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }

  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const slug = String(requestUrl.searchParams.get('slug') || '').trim();

  const shellResponse = await fetch(
    new URL('/', origin),
    { headers: { accept: 'text/html' } }
  );
  const shell = await shellResponse.text();

  if (!shellResponse.ok) {
    return htmlResponse(
      request.method === 'HEAD' ? null : shell,
      shellResponse.status
    );
  }

  let html = shell;

  if (slug) {
    try {
      const { products } = await loadPublicCatalog(
        origin,
        { requestedSlug: slug }
      );
      const product = selectPreviewProduct(products, slug);

      if (product) {
        html = injectProductPreviewMetadata(shell, product, origin);
      }
    } catch (error) {
      console.error(
        'No se pudo preparar la vista previa social del producto:',
        error
      );
    }
  }

  return htmlResponse(
    request.method === 'HEAD' ? null : html
  );
}
