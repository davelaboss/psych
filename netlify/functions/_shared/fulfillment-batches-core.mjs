export const FULFILLMENT_STATUSES = Object.freeze([
  'OPEN',
  'PREPARED',
  'DELIVERED',
  'LEGACY_FROZEN',
]);

export function orderItems(orderSnapshot) {
  return Array.isArray(orderSnapshot?.items) ? orderSnapshot.items : [];
}

export function normalizeAsciiText(value) {
  return typeof value === 'string'
    ? value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
    : '';
}

export function normalizeProductId(value) {
  return normalizeAsciiText(value);
}

export function explicitProductIds(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw Object.assign(new Error('Seleccioná al menos un artículo para separar.'), {
      status: 400,
      code: 'FULFILLMENT_ITEMS_REQUIRED',
    });
  }
  const normalized = productIds.map(normalizeProductId);
  if (normalized.some(value => !value) || new Set(normalized).size !== normalized.length) {
    throw Object.assign(new Error('La selección de artículos no es válida.'), {
      status: 400,
      code: 'FULFILLMENT_ITEMS_INVALID',
    });
  }
  return normalized;
}

export function timingKeyForItem(item) {
  if (normalizeAsciiText(item?.saleMode).toUpperCase() !== 'DELAYED') {
    return 'IMMEDIATE';
  }
  const start = normalizeAsciiText(item?.pickupWindowStart) || 'UNSET';
  const end = normalizeAsciiText(item?.pickupWindowEnd) || 'UNSET';
  return `DELAYED:${start}:${end}`;
}

export function timingLabel(timingKey) {
  if (timingKey === 'IMMEDIATE') return 'Retiro inmediato';
  const [, start = 'UNSET', end = 'UNSET'] = String(timingKey || '').split(':');
  if (start === 'UNSET' && end === 'UNSET') return 'Retiro posterior';
  return `Retiro posterior: ${start} a ${end}`;
}

export function isAutoAttachBatch(batch, buyerGroupId, timingKey) {
  return batch?.buyerGroupId === buyerGroupId &&
    batch?.timingKey === timingKey &&
    batch?.status === 'OPEN' &&
    batch?.autoAttach === true &&
    !batch?.mergedIntoBatchId;
}

export function chooseAutoAttachBatch(batches, buyerGroupId, timingKey) {
  const eligible = batches.filter(batch => isAutoAttachBatch(batch, buyerGroupId, timingKey));
  if (eligible.length > 1) {
    throw Object.assign(new Error('Hay más de un lote abierto para este comprador y tipo de retiro.'), {
      status: 409,
      code: 'DUPLICATE_OPEN_BATCH',
    });
  }
  return eligible[0] || null;
}

export function assertExpectedRevision(batch, expectedRevision) {
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected < 1 || Number(batch?.revision) !== expected) {
    throw Object.assign(new Error('El lote cambió en otra pestaña. Actualizá el panel e intentá nuevamente.'), {
      status: 409,
      code: 'FULFILLMENT_REVISION_CONFLICT',
    });
  }
}

export function nextStatus(currentStatus, action) {
  if (action === 'PREPARE' && currentStatus === 'OPEN') return 'PREPARED';
  if (action === 'DELIVER' && currentStatus === 'PREPARED') return 'DELIVERED';
  if (action === 'REOPEN' && ['PREPARED', 'LEGACY_FROZEN'].includes(currentStatus)) return 'OPEN';
  throw Object.assign(new Error('El lote ya no admite esa acción.'), {
    status: 409,
    code: 'FULFILLMENT_INVALID_TRANSITION',
  });
}

export function groupLegacyMembership(rows) {
  const groups = new Map();
  for (const row of rows) {
    const productId = normalizeProductId(row.item?.productId);
    if (!productId) continue;
    const timingKey = timingKeyForItem(row.item);
    const key = `${row.buyerGroupId}|${timingKey}`;
    const group = groups.get(key) || {
      buyerGroupId: row.buyerGroupId,
      timingKey,
      status: 'LEGACY_FROZEN',
      autoAttach: false,
      items: [],
    };
    group.items.push({ orderId: row.orderId, productId });
    groups.set(key, group);
  }
  return [...groups.values()];
}
