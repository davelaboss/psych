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

// Apply after saved Admin fields so stale source sync/overrides cannot resurrect
// archives or gifts. No storage writes, payments, buyers or orders are created.
export function applyReviewDisposition(product) {
  const decision = reviewDisposition(product);
  if (!decision || decision.disposition === 'ARCHIVED') return product;
  if (decision.disposition === 'RESTORED') {
    if (product.itemNumber !== 31) return product;
    return { ...product, quantityTotal: 2 };
  }
  return {
    ...product, askingPricePYG: 0, status: 'SOLD', needsReview: false,
    quantityRemaining: 0, quantityHeld: 0, quantitySold: 0,
    ...(product.itemNumber === 96 ? { quantityTotal: 1, quantityStructure: 'Una tabla; regalada. Sin unidades disponibles.' } : {}),
    ...(product.itemNumber === 137 ? { title: 'Juego 7 en 1', category: 'Juegos', description: 'Juego con siete juegos diferentes.' } : {}),
  };
}
