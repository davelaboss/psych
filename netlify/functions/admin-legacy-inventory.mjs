import {
  adminAuthorized,
  jsonResponse,
  getProductOverride,
  loadCatalog,
} from './_shared/commerce.mjs';

import {
  PHASE2_BATCH_ID,
  PHASE2_BATCH_ITEMS,
  PHASE2_BATCH_NAME,
} from '../../source/lib/phase2-batch.ts';

import {
  VOLUME2_BATCH_ID,
  VOLUME2_BATCH_ITEMS,
  VOLUME2_BATCH_NAME,
} from '../../source/lib/volume2-batch.ts';


function centralEstimate(low, high) {
  if (
    !Number.isFinite(Number(low)) ||
    !Number.isFinite(Number(high))
  ) {
    return null;
  }

  return Math.round(
    (Number(low) + Number(high)) / 2
  );
}


function normalizePhase2(item) {
  return {
    id: item.id,
    itemNumber: item.itemNumber,
    batchId: PHASE2_BATCH_ID,
    batchName: PHASE2_BATCH_NAME,

    title: item.title,
    category: item.category,
    description: item.description,
    condition: item.condition,
    conditionNotes: item.conditionNotes,
    knownDefects: item.knownDefects,

    includedAccessories:
      item.includedAccessories || [],

    photoFiles:
      item.photos || [],

    askingPricePYG:
      Number(item.asking || 0),

    marketLowPYG:
      Number(item.marketLow || 0),

    marketHighPYG:
      Number(item.marketHigh || 0),

    marketEstimatePYG:
      centralEstimate(
        item.marketLow,
        item.marketHigh
      ),

    recommendedFastSalePricePYG:
      Number(item.fast || 0),

    adminPriceFloorPYG:
      Number(item.floor || 0),

    pricingConfidence:
      item.confidence || null,

    pricingResearch:
      item.research || null,

    saleMode:
      item.saleMode,

    pickupAvailableDate:
      item.pickupDate,

    pickupWindowStart:
      item.pickupWindowStart,

    pickupWindowEnd:
      item.pickupWindowEnd,

    quantityTotal: 1,

    requiresVehicle:
      Boolean(item.requiresVehicle),

    requiresLoadingHelp:
      Boolean(item.requiresLoadingHelp),

    reviewFlag:
      item.flag || null,

    sellerConfirmedFields:
      item.sellerConfirmedFields || [],
  };
}


function normalizeVolume2(item) {
  return {
    id: item.id,
    itemNumber: item.itemNumber,
    batchId: VOLUME2_BATCH_ID,
    batchName: VOLUME2_BATCH_NAME,

    title: item.title,
    category: item.category,
    description: item.description,
    condition: item.condition,
    conditionNotes: item.conditionNotes,
    knownDefects: item.knownDefects,

    includedAccessories:
      item.includedAccessories || [],

    photoFiles:
      item.photos || [],

    askingPricePYG:
      Number(item.asking || 0),

    marketLowPYG:
      Number(item.marketLow || 0),

    marketHighPYG:
      Number(item.marketHigh || 0),

    marketEstimatePYG:
      centralEstimate(
        item.marketLow,
        item.marketHigh
      ),

    recommendedFastSalePricePYG:
      Number(item.fast || 0),

    adminPriceFloorPYG:
      Number(item.floor || 0),

    pricingConfidence:
      item.confidence || null,

    pricingResearch:
      item.research || null,

    saleMode:
      item.saleMode,

    pickupAvailableDate:
      item.pickupDate,

    pickupWindowStart:
      item.pickupWindowStart,

    pickupWindowEnd:
      item.pickupWindowEnd,

    quantityTotal:
      Number(item.quantityTotal || 1),

    requiresVehicle:
      Boolean(item.requiresVehicle),

    requiresLoadingHelp:
      Boolean(item.requiresLoadingHelp),

    reviewFlag:
      item.flag || null,

    quantityStructure:
      item.quantityStructure || null,

    measurements:
      item.measurements || null,

    notIncludedVisible:
      item.notIncludedVisible || null,

    functionality:
      item.functionality || null,

    sellerConfirmedFields: [],
  };
}


function normalizeLiveOnly(product) {
  return {
    id: product.id,
    itemNumber:
      product.itemNumber ?? null,

    batchId: 'live-only',
    batchName:
      'Catálogo público actual',

    title: product.title,
    category: product.category,
    description:
      product.description || '',

    condition:
      product.condition || '',

    conditionNotes:
      product.conditionNotes || '',

    knownDefects:
      product.knownDefects || '',

    includedAccessories:
      product.includedAccessories || [],

    photoFiles: [],

    askingPricePYG:
      Number(
        product.askingPricePYG || 0
      ),

    marketLowPYG: null,
    marketHighPYG: null,
    marketEstimatePYG: null,
    recommendedFastSalePricePYG: null,
    adminPriceFloorPYG: null,
    pricingConfidence: null,
    pricingResearch: null,

    saleMode:
      product.saleMode,

    pickupAvailableDate:
      product.pickupAvailableDate || null,

    pickupWindowStart:
      product.pickupWindowStart || null,

    pickupWindowEnd:
      product.pickupWindowEnd || null,

    quantityTotal:
      Number(
        product.quantityTotal || 1
      ),

    requiresVehicle:
      Boolean(product.requiresVehicle),

    requiresLoadingHelp:
      Boolean(
        product.requiresLoadingHelp
      ),

    reviewFlag: null,
    sellerConfirmedFields:
      product.sellerConfirmedFields || [],
  };
}


function liveKey(product) {
  if (
    product.itemNumber !== null &&
    product.itemNumber !== undefined
  ) {
    return `item:${Number(
      product.itemNumber
    )}`;
  }

  return `id:${product.id}`;
}


export default async function handler(request) {
  if (!adminAuthorized(request)) {
    return jsonResponse(
      {
        error:
          'Acceso no autorizado.',
      },
      401
    );
  }

  if (request.method !== 'GET') {
    return jsonResponse(
      {
        error:
          'Método no permitido.',
      },
      405
    );
  }

  try {
    const origin =
      new URL(request.url).origin;

    const liveCatalog =
      await loadCatalog(origin);

    const liveByKey =
      new Map();

    for (const product of liveCatalog) {
      liveByKey.set(
        liveKey(product),
        product
      );
    }

    const baseLegacyProducts = [
      ...PHASE2_BATCH_ITEMS.map(
        normalizePhase2
      ),
      ...VOLUME2_BATCH_ITEMS.map(
        normalizeVolume2
      ),
    ];

    const legacyProducts =
      await Promise.all(
        baseLegacyProducts.map(
          async (product) => {
            const override =
              await getProductOverride(
                product.id
              );

            if (!override) {
              return product;
            }

            return {
              ...product,
              ...(override.publicFields || {}),
              ...(override.internalFields || {}),

              images:
                Object.prototype.hasOwnProperty.call(
                  override,
                  'images'
                )
                  ? override.images
                  : undefined,
            };
          }
        )
      );

    const seenLiveKeys =
      new Set();

    const products =
      legacyProducts.map(
        (product) => {
          const key =
            liveKey(product);

          const live =
            liveByKey.get(key) ||
            liveCatalog.find(
              (candidate) =>
                candidate.id ===
                product.id
            ) ||
            null;

          if (live) {
            seenLiveKeys.add(
              liveKey(live)
            );
          }

          return {
            ...product,

            published:
              Boolean(live),

            images:
              Array.isArray(
                product.images
              )
                ? product.images
                : live?.images || [],

            live: live
              ? {
                  id: live.id,
                  slug: live.slug,
                  status: live.status,
                  title: live.title,
                  category:
                    live.category,
                  askingPricePYG:
                    live.askingPricePYG,
                  images:
                    live.images || [],
                  quantityTotal:
                    live.quantityTotal ??
                    1,
                  quantityRemaining:
                    live.quantityRemaining ??
                    0,
                  quantitySold:
                    live.quantitySold ??
                    0,
                }
              : null,
          };
        }
      );

    for (const live of liveCatalog) {
      const key =
        liveKey(live);

      if (
        seenLiveKeys.has(key)
      ) {
        continue;
      }

      products.push({
        ...normalizeLiveOnly(live),
        published: true,

        live: {
          id: live.id,
          slug: live.slug,
          status: live.status,
          title: live.title,
          category:
            live.category,
          askingPricePYG:
            live.askingPricePYG,
          images:
            live.images || [],
          quantityTotal:
            live.quantityTotal ??
            1,
          quantityRemaining:
            live.quantityRemaining ??
            0,
          quantitySold:
            live.quantitySold ??
            0,
        },
      });
    }

    products.sort(
      (a, b) =>
        Number(
          a.itemNumber || 999999
        ) -
        Number(
          b.itemNumber || 999999
        )
    );

    return jsonResponse({
      ok: true,

      batches: [
        {
          id:
            PHASE2_BATCH_ID,

          name:
            PHASE2_BATCH_NAME,
        },

        {
          id:
            VOLUME2_BATCH_ID,

          name:
            VOLUME2_BATCH_NAME,
        },

        {
          id:
            'live-only',

          name:
            'Catálogo público actual',
        },
      ],

      products,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo recuperar el inventario anterior.',
      },
      500
    );
  }
}
