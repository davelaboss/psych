import {
  VOLUME2_BATCH_ITEMS,
} from '../../../source/lib/volume2-batch.ts';

import {
  VOLUME2_IMAGE_MAP,
} from '../../../source/lib/volume2-image-map.mjs';


function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}


function removeUsedWords(value) {
  return String(value || '')
    .replace(/\b(usado|usada|usados|usadas)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, '')
    .trim();
}


function cleanDescription(item) {
  let value = removeUsedWords(item.description);

  const privatePhrases = [
    'No se identificaron otros objetos visibles que deban considerarse incluidos.',
    'Se conservan las fotografías originales sin retoque.',
    'Revisar señales de uso y detalles visibles antes de aprobar.',
  ];

  for (const phrase of privatePhrases) {
    value = value.replace(phrase, '');
  }

  return value
    .replace(/\s{2,}/g, ' ')
    .trim();
}


function publicCondition(item) {
  const value = removeUsedWords(item.condition);

  if (
    !value ||
    /estado visual según fotografías/i.test(value)
  ) {
    return 'Estado visual según fotografías';
  }

  return value;
}


function publicConditionNotes() {
  // Volume 2's current conditionNotes are review instructions,
  // not buyer-facing product facts.
  return '';
}


function publicKnownDefects() {
  // Volume 2's current knownDefects field is mostly composed of
  // internal verification tasks ("Confirmar...", "Revisar...", etc.).
  // Confirmed defects can be added later through Admin.
  return '';
}


export function volume2Products() {
  return VOLUME2_BATCH_ITEMS.map(
    (item) => ({
      id: item.id,
      itemNumber: item.itemNumber,
      slug: `${slugify(item.title)}-${item.itemNumber}`,
      title: removeUsedWords(item.title),
      category: item.category,
      tags: [
        item.category.toLowerCase(),
        'venta de mudanza',
        'volumen 2',
      ],
      description: cleanDescription(item),
      condition: publicCondition(item),
      conditionNotes: publicConditionNotes(item),
      knownDefects: publicKnownDefects(item),
      images: (item.photos || [])
        .map(
          (name) =>
            VOLUME2_IMAGE_MAP[name] || ''
        )
        .filter(Boolean),
      askingPricePYG: Number(item.asking || 0),
      originalPricePYG: null,
      saleMode: item.saleMode,
      pickupAvailableDate: item.pickupDate,
      pickupWindowStart: item.pickupWindowStart,
      pickupWindowEnd: item.pickupWindowEnd,
      depositPercent:
        item.saleMode === 'DELAYED'
          ? 25
          : 100,
      requiresVehicle:
        Boolean(item.requiresVehicle),
      requiresLoadingHelp:
        Boolean(item.requiresLoadingHelp),
      logisticsNotes: [
        item.requiresVehicle
          ? 'Requiere vehículo adecuado.'
          : '',
        item.requiresLoadingHelp
          ? 'El comprador debe traer ayuda para cargar.'
          : '',
      ].filter(Boolean),
      includedAccessories:
        item.includedAccessories || [],
      sellerConfirmedFields: [],
      status: 'AVAILABLE',
      featured: false,
      dateListed: '2026-09-23',
      lastPriceChange: null,
      isDemo: false,
      needsReview: false,
      quantityTotal:
        Number(item.quantityTotal || 1),
      quantityRemaining:
        Number(item.quantityTotal || 1),
      quantityHeld: 0,
      quantitySold: 0,
    })
  );
}
