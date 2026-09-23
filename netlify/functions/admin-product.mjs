import {
  adminAuthorized,
  getProductOverride,
  jsonResponse,
  saveProductOverride,
} from './_shared/commerce.mjs';


const PUBLIC_FIELDS = new Set([
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
  'quantityRemaining',
]);


const INTERNAL_FIELDS = new Set([
  'marketLowPYG',
  'marketHighPYG',
  'marketEstimatePYG',
  'recommendedFastSalePricePYG',
  'adminPriceFloorPYG',
  'pricingConfidence',
  'pricingResearch',
  'reviewFlag',
  'internalNotes',
]);


function filtered(source, allowed) {
  const result = {};

  for (const [key, value] of Object.entries(source || {})) {
    if (allowed.has(key)) {
      result[key] = value;
    }
  }

  return result;
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

    const current =
      await getProductOverride(productId) || {
        productId,
        publicFields: {},
        internalFields: {},
      };

    const next = {
      ...current,

      publicFields: {
        ...(current.publicFields || {}),
        ...filtered(
          body.publicFields,
          PUBLIC_FIELDS
        ),
      },

      internalFields: {
        ...(current.internalFields || {}),
        ...filtered(
          body.internalFields,
          INTERNAL_FIELDS
        ),
      },
    };

    const saved =
      await saveProductOverride(
        productId,
        next
      );

    return jsonResponse({
      ok: true,
      override: saved,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron guardar los cambios.',
      },
      400
    );
  }
}
