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
