export const PUBLIC_CONFIG = {
  siteName: 'Venta de Mudanza',
  pickupArea: '[PUBLIC_PICKUP_AREA]',
  whatsappNumber: '[WHATSAPP_NUMBER]',
  defaultDepositPercent: 25,
  holdMinutes: 15,
  movingDateCopy: 'diciembre de 2026',
} as const;

export const BANK_TRANSFER_PLACEHOLDERS = {
  bankName: '[BANK_NAME]',
  accountHolder: '[ACCOUNT_HOLDER]',
  accountType: '[ACCOUNT_TYPE]',
  accountNumberOrAlias: '[ACCOUNT_NUMBER_OR_ALIAS]',
  sellerIdReference: '[SELLER_ID_REFERENCE]',
} as const;

export function whatsappHref(message: string): string {
  const number = PUBLIC_CONFIG.whatsappNumber.replace(/\D/g, '');
  const base = number ? `https://wa.me/${number}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(message)}`;
}
