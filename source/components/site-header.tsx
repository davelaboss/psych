'use client';

import { PUBLIC_CONFIG, whatsappHref } from '@/lib/config';
import { useCart } from './cart-provider';

export function SiteHeader() {
  const cart = useCart();
  return (
    <>
      <div className="pickup-strip">
        <span>Retiro únicamente en {PUBLIC_CONFIG.pickupArea}</span>
        <span aria-hidden="true">·</span>
        <span>Sin delivery ni envíos</span>
      </div>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Venta de Mudanza, inicio">
          <span className="brand-mark">VM</span>
          <span><strong>Venta de Mudanza</strong><small>Venta particular · Paraguay</small></span>
        </a>
        <nav aria-label="Navegación principal">
          <a href="/#articulos">Artículos</a>
          <a href="/#preguntas">Preguntas</a>
          <a className="whatsapp-nav" href={whatsappHref('Hola, quisiera consultar sobre la venta de mudanza.')} target="_blank" rel="noreferrer">WhatsApp</a>
          <a className="cart-link" href="/carrito">Carrito <span>{cart.ids.length}</span></a>
        </nav>
      </header>
    </>
  );
}
