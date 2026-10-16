import {
  productMediaStore,
} from './_shared/commerce.mjs';


export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response(
      'Método no permitido.',
      { status: 405 }
    );
  }

  const url = new URL(request.url);

  const key =
    String(
      url.searchParams.get('key') || ''
    ).trim();

  if (!key) {
    return new Response(
      'Foto no encontrada.',
      { status: 404 }
    );
  }

  const entry =
    await productMediaStore()
      .getWithMetadata(
        key,
        {
          type: 'text',
          consistency: 'strong',
        }
      );

  if (!entry?.data) {
    return new Response(
      'Foto no encontrada.',
      { status: 404 }
    );
  }

  const bytes =
    Buffer.from(
      entry.data,
      'base64'
    );

  return new Response(
    bytes,
    {
      status: 200,
      headers: {
        'content-type':
          entry.metadata?.contentType ||
          'image/jpeg',

        'cache-control':
          'public, max-age=86400',
      },
    }
  );
}
