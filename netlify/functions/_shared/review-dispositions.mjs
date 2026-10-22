// David's one-time decisions, 2026-10-21. Match immutable IDs AND numbers.
// Historical source records and original media are intentionally left intact.
export const REVIEW_DISPOSITIONS = Object.freeze([
  [17, 'ARCHIVED', 'Registro duplicado. No publicar.'],
  [31, 'RESTORED', 'Planta recuperada; el vendedor confirma otra planta además de la comprometida en VM-2026-042A512D.'],
  [44, 'ARCHIVED', 'Registro duplicado. No publicar.'],
  [53, 'ARCHIVED', 'Incluida en otro anuncio; registro redundante. No se identifica otro Item por suposición.'],
  [90, 'RESTORED', 'Lista para volver a la venta; conservar fotos, accesorios, funcionamiento y retiro posterior.'],
  [96, 'REGALADO', 'Una sola tabla, regalada; cantidad histórica corregida de dos a una. Sin ingreso ni transacción.'],
  [111, 'ARCHIVED', 'Duplicado de Item 045. Conservar Item 045.'],
  [117, 'ARCHIVED', 'Archivar el juego histórico completo. Los dos paneles serán Items nuevos en Volumen 5, por separado; no reutilizar ID ni precio del juego.'],
  [118, 'ARCHIVED', 'Duplicado de Item 054. Conservar Item 054.'],
  [128, 'ARCHIVED', 'Absorbido por Item 129. Conservar Item 129 sin cambios.'],
  [132, 'REGALADO', 'Regalado. Sin ingreso ni transacción.'],
  [137, 'REGALADO', 'Juego con siete juegos diferentes, regalado. Sin ingreso ni transacción.'],
].map(([itemNumber, disposition, reason]) => Object.freeze({
  id: itemNumber < 58 ? `real-20260828-${String(itemNumber).padStart(2, '0')}` : `real-202609-volume2-${itemNumber}`,
  itemNumber, disposition, reason, authorizedOn: '2026-10-21',
})));

export function reviewDisposition(product) {
  return REVIEW_DISPOSITIONS.find(entry => entry.id === product?.id && entry.itemNumber === Number(product.itemNumber));
}

export function isReviewArchived(product) {
  return reviewDisposition(product)?.disposition === 'ARCHIVED';
}

// Seller-approved public listing recovered from September 25 commit f57fe59.
// The two original plants share this Item ID; one is already committed.
export const ITEM_031_APPROVED_PUBLIC = Object.freeze({
  slug: 'tradescantia-morada-con-maceta-y-soporte',
  title: 'Tradescantia morada con maceta (cada una)',
  askingPricePYG: 25000,
  description: 'Tradescantia morada con maceta, vendida por unidad. El precio corresponde a una planta con su maceta. La mesa no está incluida.',
  conditionNotes: 'Follaje abundante.',
  knownDefects: '',
  includedAccessories: ['1 planta Tradescantia morada', '1 maceta'],
  sellerConfirmedFields: ['askingPricePYG', 'conditionNotes', 'description', 'includedAccessories', 'quantityRemaining', 'quantityTotal', 'title'],
});

// The original photos depict different plants, and the order does not identify
// which was committed. Withhold both from sale pending owner identification;
// originals remain in the historical source and are never deleted.
function item031SaleImages(images) {
  return (Array.isArray(images) ? images : []).filter(image => {
    const url = new URL(image, 'https://thelabossieres.com');
    const path = url.pathname === '/.netlify/images'
      ? new URL(url.searchParams.get('url') || '', url.origin).pathname : url.pathname;
    return !/^\/assets\/media\/real-20260828-31-[01]\.jpg$/.test(path);
  });
}

function reconcileItem031(product) {
  const next = { ...product, quantityTotal: 2, images: item031SaleImages(product.images) };
  // Reject only the known obsolete source values. Other saved seller edits win.
  const obsolete = {
    title: 'Tradescantia morada con maceta y soporte',
    askingPricePYG: 170000,
    description: 'Planta de follaje morado en maceta, con soporte de madera incluido.',
    conditionNotes: 'Dos vistas del mismo conjunto; follaje abundante.',
    knownDefects: 'Estado de raíces no verificado.',
  };
  for (const [field, value] of Object.entries(obsolete)) {
    if (next[field] === value) next[field] = structuredClone(ITEM_031_APPROVED_PUBLIC[field]);
  }
  if (!Array.isArray(next.includedAccessories) || !next.includedAccessories.length) {
    next.includedAccessories = [...ITEM_031_APPROVED_PUBLIC.includedAccessories];
  }
  return next;
}

export function withItem031Availability(product) {
  if (product?.id !== 'real-20260828-31' || Number(product.itemNumber) !== 31) return product;
  const description = String(product.description || '')
    .replace(/Hay\s+\d+\s+plantas?\s+disponibles?\.?\s*(?:y\s+)?/gi, '')
    .replace(/cada foto muestra una de las dos unidades\.?\s*/gi, '')
    .replace(/Quedan?\s+\d+\s+plantas?\s+disponibles?\.?\s*/gi, '')
    .replace(/No quedan plantas disponibles\.?\s*/gi, '')
    .trim();
  const availability = Number(product.quantityRemaining) > 0 && product.status === 'AVAILABLE'
    ? 'Queda 1 planta disponible.' : 'No quedan plantas disponibles.';
  return { ...product, description: `${description}${description && !/[.!?]$/.test(description) ? '.' : ''} ${availability}`.trim() };
}

// Apply after saved Admin fields so stale source sync/overrides cannot resurrect
// archives or gifts. No storage writes, payments, buyers or orders are created.
export function applyReviewDisposition(product) {
  const decision = reviewDisposition(product);
  if (!decision || decision.disposition === 'ARCHIVED') return product;
  if (decision.disposition === 'RESTORED') {
    if (product.itemNumber !== 31) return product;
    return reconcileItem031(product);
  }
  return {
    ...product, askingPricePYG: 0, status: 'SOLD', needsReview: false,
    quantityRemaining: 0, quantityHeld: 0, quantitySold: 0,
    ...(product.itemNumber === 96 ? { quantityTotal: 1, quantityStructure: 'Una tabla; regalada. Sin unidades disponibles.' } : {}),
    ...(product.itemNumber === 137 ? { title: 'Juego 7 en 1', category: 'Juegos', description: 'Juego con siete juegos diferentes.' } : {}),
  };
}
