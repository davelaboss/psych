import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductActions } from '@/components/product-actions';
import { ProductImageGallery } from '@/components/image-lightbox';
import { getPublicProductBySlug } from '@/lib/database';
import { dueNowForProduct, formatItemNumber, formatPickupWindow, formatPYG, itemTitle, publicStatusLabel } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublicProductBySlug(slug);
  if (!product) return { title: 'Artículo no encontrado', openGraph: { images: [] }, twitter: { images: [] } };
  const title = `${itemTitle(product)} · ${formatPYG(product.askingPricePYG)}`;
  const description = `${product.condition}. ${product.saleMode === 'DELAYED' ? `Retiro ${formatPickupWindow(product.pickupWindowStart, product.pickupWindowEnd, product.pickupAvailableDate)}.` : 'Disponible para retiro inmediato.'}`;
  const images = product.images[0] ? [{ url: product.images[0], alt: product.title }] : [];
  return {
    title, description,
    openGraph: { title, description, type: 'website', images },
    twitter: { card: 'summary_large_image', title, description, images: images.map((image) => image.url) },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getPublicProductBySlug(slug);
  if (!product) notFound();
  const dueNow = dueNowForProduct(product);
  const balance = product.askingPricePYG - dueNow;

  return <main className="product-page">
    <nav className="breadcrumbs" aria-label="Migas de pan"><a href="/#articulos">← Volver al catálogo</a><span>/</span><span>{product.category}</span><span>/</span><span>{product.title}</span></nav>
    <section className="product-detail">
      <ProductImageGallery images={product.images} title={product.title} isDemo={product.isDemo} status={product.status} />
      <div className="product-information">
        <div className="product-meta detail-meta"><span>{product.isDemo ? product.category : `${formatItemNumber(product.itemNumber)} · ${product.category}`}</span>{product.status === 'AVAILABLE' ? <span className={product.saleMode === 'IMMEDIATE' ? 'status-now' : 'status-later'}>{product.saleMode === 'IMMEDIATE' ? 'DISPONIBLE AHORA' : 'RETIRO 9–12 DIC.'}</span> : <span className="status-unavailable">{publicStatusLabel(product.status).toUpperCase()}</span>}</div>
        <h1>{product.title}</h1>
        {product.originalPricePYG ? <del>{formatPYG(product.originalPricePYG)}</del> : null}
        <strong className="detail-price">{formatPYG(product.askingPricePYG)}{(product.quantityTotal ?? 1) > 1 ? ' por unidad' : ''}</strong>
        {(product.quantityTotal ?? 1) > 1 ? <p>{product.quantityRemaining} unidades disponibles</p> : null}
        <span className="condition-pill">{product.condition}</span>
        <p className="lead">{product.description}</p>

        <div className="payment-breakdown">
          <div><span>Precio total</span><strong>{formatPYG(product.askingPricePYG)}</strong></div>
          <div className="due"><span>{product.saleMode === 'DELAYED' ? `Reserva hoy (${product.depositPercent}%)` : 'A pagar ahora'}</span><strong>{formatPYG(dueNow)}</strong></div>
          {balance > 0 ? <div><span>Saldo al retirar</span><strong>{formatPYG(balance)}</strong></div> : null}
          <div><span>Retiro</span><strong>{product.saleMode === 'DELAYED' ? `Ventana del ${formatPickupWindow(product.pickupWindowStart, product.pickupWindowEnd, product.pickupAvailableDate)}` : 'Disponible después de confirmar el pago'}</strong></div>
        </div>

        <ProductActions product={product} />
        <p className="reservation-rule">Un mensaje de interés no reserva el artículo. Queda garantizado únicamente después de que confirmemos el pago correspondiente.</p>
      </div>
    </section>

    <section className="product-notes">
      <div><span className="section-kicker">DETALLES</span><h2>Lo que tenés que saber</h2></div>
      <dl><div><dt>Item ID</dt><dd>{formatItemNumber(product.itemNumber)}</dd></div><div><dt>Estado</dt><dd>{product.condition}</dd></div><div><dt>Observaciones</dt><dd>{product.conditionNotes}</dd></div><div><dt>Defectos conocidos</dt><dd>{product.knownDefects}</dd></div><div><dt>Accesorios incluidos</dt><dd>{product.includedAccessories.length ? product.includedAccessories.join(' · ') : 'Ninguno indicado'}</dd></div><div><dt>Disponibilidad</dt><dd>{publicStatusLabel(product.status)}</dd></div></dl>
      <div className="logistics"><strong>Para el retiro</strong><ul>{product.logisticsNotes.map((note) => <li key={note}>{note}</li>)}</ul><p>El comprador es responsable del transporte. No hacemos delivery ni envíos.</p></div>
    </section>
  </main>;
}
