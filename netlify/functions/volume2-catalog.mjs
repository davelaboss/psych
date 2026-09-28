import {
  jsonResponse,
  loadCatalog,
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

  const products =
    await loadCatalog(origin);

  return jsonResponse({
    ok: true,
    products,
  });
}
