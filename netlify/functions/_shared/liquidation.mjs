export const LIQUIDATION_ID = 'moving-sale-final-2026-11-13';
const PROTECTED_ITEMS = new Set([274, 313, 615]);

export function liquidationEnabled() {
  return process.env.FINAL_LIQUIDATION_ENABLED === 'true';
}

// Asking prices stay in Admin. This projection never writes product overrides.
export function liquidationPrice(product, inventory, enabled = liquidationEnabled()) {
  const price = Number(product.askingPricePYG);
  if (!enabled || PROTECTED_ITEMS.has(Number(product.itemNumber)) ||
      product.status !== 'AVAILABLE' || !['IMMEDIATE', 'DELAYED'].includes(product.saleMode) ||
      (product.currency && product.currency !== 'PYG') || !Number.isSafeInteger(price) || price <= 0 ||
      Number(product.quantityRemaining) <= 0 || !inventory || Number(inventory.purchasable_quantity) <= 0) return product;
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
