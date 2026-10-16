import {
  adminAuthorized,
  getProductOverride,
  jsonResponse,
  loadBaseCatalog,
  loadCatalog,
  saveProductOverride,
} from './_shared/commerce.mjs';


const SOURCE_SYNC_FIELDS = [
  'title',
  'category',
  'description',
  'condition',
  'conditionNotes',
  'knownDefects',
  'includedAccessories',
  'askingPricePYG',
  'saleMode',
  'depositPercent',
  'pickupAvailableDate',
  'pickupWindowStart',
  'pickupWindowEnd',
  'requiresVehicle',
  'requiresLoadingHelp',
  'quantityTotal',
];


function sameValue(a, b) {
  return JSON.stringify(a ?? null) ===
    JSON.stringify(b ?? null);
}


export default async function handler(request) {
  if (!adminAuthorized(request)) {
    return jsonResponse(
      { error: 'Acceso no autorizado.' },
      401
    );
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  try {
    const body = await request.json();

    const productId =
      String(body?.productId || '').trim();

    if (!productId) {
      throw new Error(
        'Falta el artículo.'
      );
    }

    const origin =
      new URL(request.url).origin;

    const [
      baseCatalog,
      liveCatalog,
    ] =
      await Promise.all([
        loadBaseCatalog(origin),
        loadCatalog(origin),
      ]);

    const base =
      baseCatalog.find(
        (product) =>
          product.id === productId
      );

    const live =
      liveCatalog.find(
        (product) =>
          product.id === productId
      );

    if (!base || !live) {
      throw new Error(
        'No se encontró el artículo en ambos catálogos.'
      );
    }

    const itemNumber =
      Number(base.itemNumber || 0);

    if (
      itemNumber < 1 ||
      itemNumber > 57
    ) {
      throw new Error(
        'La sincronización automática solo aplica a Items 001–057.'
      );
    }

    const changedFields =
      SOURCE_SYNC_FIELDS.filter(
        (field) =>
          !sameValue(
            base[field],
            live[field]
          )
      );

    if (!changedFields.length) {
      return jsonResponse({
        ok: true,
        changedFields: [],
        message:
          'La información pública ya coincide con la fuente.',
      });
    }

    const current =
      await getProductOverride(productId) || {
        productId,
        publicFields: {},
        internalFields: {},
      };

    const publicFields = {
      ...(current.publicFields || {}),
    };

    for (const field of changedFields) {
      publicFields[field] =
        structuredClone(
          base[field] ?? null
        );
    }

    const saved =
      await saveProductOverride(
        productId,
        {
          ...current,
          publicFields,
        }
      );

    return jsonResponse({
      ok: true,
      changedFields,
      override: saved,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo sincronizar el artículo.',
      },
      400
    );
  }
}
