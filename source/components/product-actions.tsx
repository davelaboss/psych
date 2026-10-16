'use client';

import { useMemo } from 'react';
import { PUBLIC_CONFIG } from '@/lib/config';
import type { PublicProduct } from '@/lib/types';
import { formatPYG, itemTitle } from '@/lib/types';
import { useCart } from './cart-provider';

export function ProductActions({ product }: { product: PublicProduct }) {
  const cart = useCart();
  const canBuy = product.status === 'AVAILABLE';
  const inCart = cart.has(product.id);
  const number = PUBLIC_CONFIG.whatsappNumber.replace(/\D/g, '');
  const base = number ? `https://wa.me/${number}` : 'https://wa.me/';
  const inquiry = useMemo(() => `${base}?text=${encodeURIComponent(`Hola, quisiera consultar por ${itemTitle(product)} (${formatPYG(product.askingPricePYG)}).`)}`, [base, product]);
  const share = useMemo(() => `${base}?text=${encodeURIComponent(`Mirá este artículo de la venta de mudanza: ${itemTitle(product)} · ${formatPYG(product.askingPricePYG)}.`)}`, [base, product]);

  return <div className="product-actions">
    <button className="primary-action" type="button" disabled={!canBuy || inCart} onClick={() => cart.add(product.id)}>
      {!canBuy ? 'No disponible' : inCart ? 'Ya está en el carrito' : product.saleMode === 'DELAYED' ? 'Reservar este artículo' : 'Agregar al carrito'}
    </button>
    <a className="secondary-action" href={inquiry} target="_blank" rel="noreferrer">Consultar por WhatsApp</a>
    <a className="text-action" href={share} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>
  </div>;
}
