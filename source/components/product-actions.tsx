'use client';

import { useMemo } from 'react';
import { PUBLIC_CONFIG } from '@/lib/config';
import { buildWhatsAppProductShareHref } from '@/lib/product-sharing';
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
  const share = useMemo(() => buildWhatsAppProductShareHref(product), [product]);

  return <div className="product-actions">
    <button className="primary-action" type="button" disabled={!canBuy || inCart} onClick={() => cart.add(product.id)}>
      {!canBuy ? 'No disponible' : inCart ? 'Ya está en el carrito' : product.saleMode === 'DELAYED' ? 'Reservar este artículo' : 'Agregar al carrito'}
    </button>
    <a className="secondary-action" href={inquiry} target="_blank" rel="noreferrer">Consultar por WhatsApp</a>
    <a className="text-action" href={share} target="_blank" rel="noreferrer">
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.59 13.51 6.83 3.98" />
          <path d="m15.41 6.51-6.82 3.98" />
        </svg>
        <span>Compartir por WhatsApp</span>
      </span>
    </a>
  </div>;
}
