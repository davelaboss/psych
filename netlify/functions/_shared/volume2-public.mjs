import {
  VOLUME2_BATCH_ITEMS,
} from '../../../source/lib/volume2-batch.ts';

import {
  SALE_READINESS_SUPPLEMENTAL_ITEMS,
} from '../../../source/lib/sale-readiness-supplemental.ts';

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
    .replace(/^[,.;:\s-]+/g, '')
    .trim();
}


function cleanPublicText(value) {
  let next = removeUsedWords(value);

  const privatePhrases = [
    'No se identificaron otros objetos visibles que deban considerarse incluidos.',
    'Se conservan las fotografías originales sin retoque.',
    'Revisar señales de uso y detalles visibles antes de aprobar.',
  ];

  for (const phrase of privatePhrases) {
    next = next.replace(phrase, '');
  }

  return next
    .replace(/\s{2,}/g, ' ')
    .trim();
}


function publicMeasurements(item) {
  const value = cleanPublicText(item.measurements);

  if (
    !value ||
    /no disponibles/i.test(value) ||
    /medir antes de publicar/i.test(value)
  ) {
    return '';
  }

  return value;
}


function publicFunctionality(item) {
  const value = cleanPublicText(item.functionality);

  if (
    !value ||
    /no verificado/i.test(value) ||
    /no aplica o no requiere/i.test(value) ||
    /estado estructural no verificado/i.test(value)
  ) {
    return '';
  }

  return value;
}


function joinDescriptionParts(parts) {
  return parts
    .filter(Boolean)
    .map((part) => String(part).trim())
    .reduce((text, part) => {
      if (!text) {
        return part;
      }

      return /[.!?]$/.test(text)
        ? `${text} ${part}`
        : `${text}. ${part}`;
    }, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}


function cleanDescription(item) {
  const description =
    cleanPublicText(item.description);

  const measurements =
    publicMeasurements(item);

  const functionality =
    publicFunctionality(item);

  const normalizedDescription =
    description
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const normalizedMeasurements =
    measurements
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const normalizedFunctionality =
    functionality
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const parts = [description];

  if (
    measurements &&
    !(
      normalizedMeasurements &&
      normalizedDescription.includes(
        normalizedMeasurements
      )
    )
  ) {
    parts.push(`Medidas: ${measurements}`);
  }

  if (
    functionality &&
    !(
      normalizedFunctionality &&
      normalizedDescription.includes(
        normalizedFunctionality
      )
    )
  ) {
    parts.push(
      `Funcionamiento: ${functionality}`
    );
  }

  return joinDescriptionParts(parts);
}


function publicKnownDefects(item) {
  const value =
    cleanPublicText(item.knownDefects);

  if (!value) {
    return '';
  }

  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) =>
      /no funciona|no enciende|falla|defecto|roto|rota|dañado|dañada|desgaste|desprendimiento/i.test(sentence)
    )
    .join(' ')
    .trim();
}


function publicCondition(item) {
  const value =
    cleanPublicText(item.condition);

  if (
    !value ||
    /estado visual\s+seg[uú]n\s+(?:las\s+)?fotograf[ií]as?/i.test(value)
  ) {
    return '';
  }

  return value;
}


function publicProduct(item) {
  const quantityTotal =
    Number(item.quantityTotal || 1);

  const status =
    item.status || 'AVAILABLE';

  const available =
    status === 'AVAILABLE';

  const sold =
    status === 'SOLD' ||
    status === 'PICKED_UP';

  return {
    id: item.id,
    itemNumber: item.itemNumber,
    slug:
      `${slugify(item.title)}-${item.itemNumber}`,
    title:
      cleanPublicText(item.title),
    category: item.category,
    tags: [
      item.category.toLowerCase(),
      'venta de mudanza',
      item.itemNumber >= 58 &&
      item.itemNumber <= 158
        ? 'volumen 2'
        : 'complementos',
    ],
    description:
      cleanDescription(item),
    condition:
      publicCondition(item),
    conditionNotes: '',
    knownDefects:
      publicKnownDefects(item),
    images:
      (item.photos || [])
        .map(
          (name) =>
            VOLUME2_IMAGE_MAP[name] || ''
        )
        .filter(Boolean),
    askingPricePYG:
      Number(item.asking || 0),
    originalPricePYG: null,
    saleMode: item.saleMode,
    pickupAvailableDate:
      item.pickupDate,
    pickupWindowStart:
      item.pickupWindowStart,
    pickupWindowEnd:
      item.pickupWindowEnd,
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
    status,
    featured: false,
    dateListed: '2026-09-23',
    lastPriceChange: null,
    isDemo: false,
    needsReview:
      Boolean(item.needsReview),
    quantityTotal,
    quantityRemaining:
      available
        ? quantityTotal
        : 0,
    quantityHeld: 0,
    quantitySold:
      sold
        ? quantityTotal
        : 0,
  };
}


export function volume2Products() {
  return [
    ...VOLUME2_BATCH_ITEMS,
    ...SALE_READINESS_SUPPLEMENTAL_ITEMS,
  ]
    .map(publicProduct)
    .filter(
      (product) =>
        product.status !== 'UNLISTED'
    )
    .sort(
      (a, b) =>
        Number(a.itemNumber) -
        Number(b.itemNumber)
    );
}
