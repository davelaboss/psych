import { readFile } from 'node:fs/promises';
import { loadPublicCatalog } from './_shared/commerce.mjs';
import {
  deriveProductPreviewSlug,
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

export function createProductPageHandler({
  readShell = () => readFile('index.html', 'utf8'),
  loadProducts = loadPublicCatalog,
} = {}) {
  return async function handler(request) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }

    const requestUrl = new URL(request.url);
    const origin = requestUrl.origin;
    const slug = deriveProductPreviewSlug(requestUrl);
    const metadataOrigin = String(process.env.URL || origin).trim();

    // Netlify bundles the same committed HTML used by loadBaseCatalog.
    const shell = await readShell();
    let html = shell;

    if (slug) {
      try {
        const { products } = await loadProducts(
          origin,
          { requestedSlug: slug }
        );
        const product = selectPreviewProduct(products, slug);

        if (product) {
          html = injectProductPreviewMetadata(shell, product, metadataOrigin);
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
  };
}

export default createProductPageHandler();
