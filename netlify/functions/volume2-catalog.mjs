import {
  jsonResponse,
  listProductOverrides,
} from './_shared/commerce.mjs';

import {
  volume2Products,
} from './_shared/volume2-public.mjs';


export default async function handler(request) {
  if (request.method !== 'GET') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  const overrides =
    await listProductOverrides();

  const byId =
    new Map(
      overrides.map(
        (override) => [
          override.productId,
          override,
        ]
      )
    );

  const products =
    volume2Products().map(
      (product) => {
        const override =
          byId.get(product.id);

        if (!override) {
          return product;
        }

        const next = {
          ...product,
          ...(override.publicFields || {}),
        };

        if (
          Object.prototype.hasOwnProperty.call(
            override,
            'images'
          )
        ) {
          next.images =
            Array.isArray(override.images)
              ? override.images
              : [];
        }

        return next;
      }
    );

  return jsonResponse({
    ok: true,
    products,
  });
}
