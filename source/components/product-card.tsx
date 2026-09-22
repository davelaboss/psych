'use client';

import { useState } from 'react';
import type { PublicProduct } from '@/lib/types';
import { formatItemNumber, formatPickupWindow, formatPYG, publicStatusLabel } from '@/lib/types';
import { useCart } from './cart-provider';
import { ImageLightbox } from './image-lightbox';

export function ProductCard({ product, compact = false }: { product: PublicProduct; compact?: boolean }) {
  const cart = useCart();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const purchasable = product.status === 'AVAILABLE';
  const sold = product.status === 'SOLD' || product.status === 'PICKED_UP';
  const reduced = product.originalPricePYG && product.originalPricePYG > product.askingPricePYG;
  const rememberCatalogPosition = () => {
    sessionStorage.setItem('mudanza-catalog-scroll', String(window.scrollY));
  };

  return (
    <article className={`product-card ${compact ? 'compact' : ''} ${sold ? 'is-sold' : ''}`}>
      <button className="product-photo" type="button" aria-label={`Ampliar fotos de ${product.title}`} onClick={() => setLightboxOpen(true)}>
        <img src={product.images[0]} alt={product.title} loading="lazy" />
        {sold ? <span className="sold-ribbon" aria-label="Vendido">VENDIDO</span> : null}
        {product.isDemo ? <span className="demo-flag">MUESTRA</span> : null}
        {reduced ? <span className="reduced-flag">REBAJADO</span> : null}
        <span className="image-enlarge-hint">Ampliar foto</span>
      </button>
      <div className="product-copy">
        <div className="product-meta">
          <span>{product.category}</span>
          {purchasable ? (
            <span className={product.saleMode === 'IMMEDIATE' ? 'status-now' : 'status-later'}>
              {product.saleMode === 'IMMEDIATE' ? 'DISPONIBLE AHORA' : 'RETIRO 9–12 DIC.'}
            </span>
          ) : <span className="status-unavailable">{publicStatusLabel(product.status).toUpperCase()}</span>}
        </div>
        {!product.isDemo ? <span className="item-number">{formatItemNumber(product.itemNumber)}</span> : null}
        <a href={`/producto/${product.slug}`} onClick={rememberCatalogPosition}><h3>{product.title}</h3></a>
        {reduced ? <del>{formatPYG(product.originalPricePYG!)}</del> : null}
        <strong className="price">{formatPYG(product.askingPricePYG)}{(product.quantityTotal ?? 1) > 1 ? ' por unidad' : ''}</strong>
        {(product.quantityTotal ?? 1) > 1 ? <p>{product.quantityRemaining} unidades disponibles</p> : null}
        <p>{product.saleMode === 'DELAYED' ? `Reserva ${product.depositPercent}% · Retiro ${formatPickupWindow(product.pickupWindowStart, product.pickupWindowEnd, product.pickupAvailableDate)}` : product.condition}</p>
        <div className="card-actions">
          <a href={`/producto/${product.slug}`} onClick={rememberCatalogPosition}>Ver detalle</a>
          <button type="button" disabled={!purchasable || cart.has(product.id)} onClick={() => cart.add(product.id)}>
            {cart.has(product.id) ? 'Agregado' : product.saleMode === 'DELAYED' ? 'Reservar' : 'Agregar'}
          </button>
        </div>
      </div>
      {lightboxOpen ? <ImageLightbox images={product.images} title={product.title} onClose={() => setLightboxOpen(false)} /> : null}
    </article>
  );
}
