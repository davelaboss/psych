import {
  jsonResponse,
  listProductOverrides,
  loadCatalog,
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

  const origin =
    new URL(request.url).origin;

  const [
    originalProducts,
    overrides,
  ] =
    await Promise.all([
      loadCatalog(origin),
      listProductOverrides(),
    ]);

  const byId =
    new Map(
      overrides.map(
        (override) => [
          override.productId,
          override,
        ]
      )
    );

  const volume2 =
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

  const products =
    [
      ...originalProducts,
      ...volume2,
    ]
      .filter(
        (product) =>
          product &&
          product.id
      )
      .filter(
        (
          product,
          index,
          all
        ) =>
          all.findIndex(
            (candidate) =>
              candidate.id ===
              product.id
          ) === index
      )
      .sort(
        (a, b) =>
          Number(a.itemNumber) -
          Number(b.itemNumber)
      );

  return jsonResponse({
    ok: true,
    products,
  });
}
