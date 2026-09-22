import {
  getAuthorizedOrder,
  jsonResponse,
  publicOrder,
} from './_shared/commerce.mjs';


export default async function handler(request) {
  if (request.method !== 'GET') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  const url =
    new URL(request.url);

  const orderId =
    String(
      url.searchParams.get('id') || ''
    ).trim();

  const accessToken =
    String(
      url.searchParams.get('access') || ''
    ).trim();

  if (
    !orderId ||
    !accessToken
  ) {
    return jsonResponse(
      { error: 'Acceso incompleto.' },
      400
    );
  }

  const order =
    await getAuthorizedOrder(
      orderId,
      accessToken
    );

  if (!order) {
    return jsonResponse(
      {
        error:
          'No encontramos ese pedido o el enlace privado no es válido.',
      },
      404
    );
  }

  return jsonResponse({
    ok: true,
    order: publicOrder(order),
  });
}