import {
  adminAuthorized,
  getOrder,
  jsonResponse,
  receiptStore,
} from './_shared/commerce.mjs';


export default async function handler(request) {
  if (!adminAuthorized(request)) {
    return jsonResponse(
      { error: 'Acceso no autorizado.' },
      401
    );
  }

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

  const order =
    await getOrder(orderId);

  const paymentId = String(url.searchParams.get('paymentId') || '').trim();
  const payment = paymentId
    ? order?.payments?.find(candidate => candidate.id === paymentId)
    : order?.payments?.find(candidate => candidate.receipt);
  const receipt = payment?.receipt || order?.receipt;

  if (
    !order ||
    !receipt?.storageKey
  ) {
    return jsonResponse(
      {
        error:
          'No hay comprobante disponible.',
      },
      404
    );
  }

  const encoded =
    await receiptStore().get(
      receipt.storageKey,
      {
        type: 'text',
        consistency: 'strong',
      }
    );

  if (!encoded) {
    return jsonResponse(
      {
        error:
          'No se encontró el archivo.',
      },
      404
    );
  }

  const bytes =
    Buffer.from(
      encoded,
      'base64'
    );

  return new Response(
    bytes,
    {
      status: 200,

      headers: {
        'content-type':
          receipt.contentType ||
          'application/octet-stream',

        'content-disposition':
          `inline; filename="${String(
            receipt.fileName ||
            'comprobante'
          ).replace(/"/g, '')}"`,

        'cache-control':
          'private, no-store',
      },
    }
  );
}
