// The private vehicle sale is outside household inventory and payment handling.
export function isInquiryOnlyProduct(product) {
  return product?.id === 'real-202611-volume6-615' ||
    product?.saleMode === 'INQUIRY' || product?.currency === 'USD';
}

export function assertHouseholdPurchase(product) {
  if (isInquiryOnlyProduct(product)) {
    const error = new Error('Este vehículo se vende por trato privado. Contactá al propietario por WhatsApp.');
    error.status = 409;
    throw error;
  }
}

// Read-only public presentation. Keep authoring status, prices and agreed terms
// intact; the inventory transaction remains the authority for every new claim.
export function withPublicPurchaseAvailability(product, inventory) {
  if (product.status !== 'AVAILABLE' || isInquiryOnlyProduct(product)) return product;
  const remaining = Number(product.quantityRemaining ?? product.quantityTotal ?? 1);
  const free = inventory == null ? remaining : Number(inventory.purchasable_quantity);
  const valid = Number.isSafeInteger(remaining) && remaining >= 0 && Number.isSafeInteger(free) && free >= 0;
  return {
    ...product,
    purchasableQuantity: valid ? Math.min(remaining, free) : 0,
    purchaseBlockedByHold: valid && remaining > 0 && free === 0 && !!inventory &&
      Number(inventory.capacity) > Number(inventory.committed_quantity),
  };
}
