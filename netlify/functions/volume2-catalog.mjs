import {
  jsonResponse,
  loadPublicCatalog,
} from './_shared/commerce.mjs';


export default async function handler(request) {
  if (request.method !== 'GET') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  const origin =
    new URL(request.url).origin;
  const requestedSlug =
    new URL(request.url).searchParams.get('slug') || '';

  const {
    products,
    deliveredProduct,
  } = await loadPublicCatalog(origin, { requestedSlug });

  return jsonResponse({
    ok: true,
    products,
    deliveredProduct,
  });
}
