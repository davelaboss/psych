export const LIQUIDATION_ID = 'moving-sale-final-2026-11-13';
const PROTECTED_ITEMS = new Set([274, 313, 615]);

export function liquidationEnabled() {
  return process.env.FINAL_LIQUIDATION_ENABLED === 'true';
}

export function newPurchaseTerms(product) {
  // Owner-confirmed correction for new purchases only. Admin authoring and
  // previously accepted cart/order terms are never overwritten.
  return [405, 441].includes(Number(product.itemNumber)) && product.saleMode === 'DELAYED'
    ? { ...product, depositPercent: 25,
        // These owner-confirmed delayed Items lack dates in the current override.
        // Use the approved delayed window; retain any narrower recorded dates.
        pickupAvailableDate: product.pickupAvailableDate || product.pickupWindowStart || '2026-12-09',
        pickupWindowStart: product.pickupWindowStart || '2026-12-09',
        pickupWindowEnd: product.pickupWindowEnd || '2026-12-12',
      }
    : product;
}

// Asking prices stay in Admin. This projection never writes product overrides.
export function liquidationPrice(product, inventory, enabled = liquidationEnabled()) {
  const price = Number(product.askingPricePYG);
  const quantity = Number(product.quantityRemaining ?? product.quantityTotal ?? 1);
  // A first claim lazily creates its operational row from this same authoritative
  // catalog quantity (cart-reservation -> productLocks). Missing row != no stock.
  // Existing rows, including zero/held/invalid availability, never use the fallback.
  const purchasable = inventory == null ? quantity : Number(inventory.purchasable_quantity);
  if (!enabled || PROTECTED_ITEMS.has(Number(product.itemNumber)) ||
      product.status !== 'AVAILABLE' || !['IMMEDIATE', 'DELAYED'].includes(product.saleMode) ||
      (product.currency && product.currency !== 'PYG') || !Number.isSafeInteger(price) || price <= 0 ||
      !Number.isSafeInteger(quantity) || quantity <= 0 ||
      !Number.isSafeInteger(purchasable) || purchasable <= 0) return product;
  const percent = price <= 12000 ? 10 : 50;
  return {
    ...product,
    ...(product.saleMode === 'DELAYED' ? { depositPercent: 25 } : {}),
    askingPricePYG: Math.round(price * (100 - percent) / 100),
    liquidation: { id: LIQUIDATION_ID, originalAskingPricePYG: price, percent },
  };
}

export function cartPricingSnapshot(product) {
  return {
    askingPricePYG: product.askingPricePYG,
    saleMode: product.saleMode,
    depositPercent: product.depositPercent,
    pickupAvailableDate: product.pickupAvailableDate || null,
    pickupWindowStart: product.pickupWindowStart || null,
    pickupWindowEnd: product.pickupWindowEnd || null,
    ...(product.liquidation ? { liquidation: product.liquidation } : {}),
  };
}

export function withCartPricing(product, snapshot) {
  // A NULL snapshot is a pre-campaign cart: retain its undiscounted Admin price.
  if (!snapshot) return product;
  if (!Number.isSafeInteger(snapshot.askingPricePYG) || snapshot.askingPricePYG <= 0) {
    throw new Error('No pudimos confirmar el precio reservado. Actualizá el carrito.');
  }
  return { ...product, ...snapshot };
}
