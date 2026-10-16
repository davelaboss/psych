import type { PublicProduct } from './types';
import { formatPYG } from './types';

const PRODUCT_SITE_ORIGIN = 'https://thelabossieres.com';

export function buildWhatsAppProductShareHref(
  product: Pick<PublicProduct, 'slug' | 'title' | 'askingPricePYG'>
): string {
  const productUrl = new URL(
    `/producto/${encodeURIComponent(product.slug)}`,
    PRODUCT_SITE_ORIGIN
  ).toString();
  const message = `Mirá este artículo de la venta de mudanza: ${product.title} · ${formatPYG(product.askingPricePYG)}.\n${productUrl}`;

  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
