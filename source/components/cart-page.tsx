'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PublicProduct } from '@/lib/types';
import { dueNowForProduct, formatPickupWindow, formatPYG, itemTitle } from '@/lib/types';
import { useCart } from './cart-provider';

export function CartPage() {
  const cart = useCart();
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cart.ready) return;
    if (!cart.ids.length) { setProducts([]); setLoading(false); return; }
    setLoading(true);
    fetch(`/api/products?ids=${encodeURIComponent(cart.ids.join(','))}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => setProducts(data.products ?? []))
      .catch(() => setError('No pudimos actualizar el carrito.'))
      .finally(() => setLoading(false));
  }, [cart.ids, cart.ready]);

  const totals = useMemo(() => products.reduce((sum, product) => {
    const due = dueNowForProduct(product);
    const quantity = cart.quantities[product.id] ?? 1;
    sum.total += product.askingPricePYG * quantity;
    sum.due += due * quantity;
    sum.balance += (product.askingPricePYG - due) * quantity;
    return sum;
  }, { total: 0, due: 0, balance: 0 }), [products, cart.quantities]);

  async function beginCheckout() {
    setSubmitting(true); setError('');
    try {
      const response = await fetch('/api/checkout/hold', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: products.map((product) => ({ productId: product.id, quantity: cart.quantities[product.id] ?? 1 })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar la compra.');
      cart.clear();
      window.location.assign(`/checkout?id=${encodeURIComponent(data.order.id)}&token=${encodeURIComponent(data.token)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo iniciar la compra.');
      setSubmitting(false);
    }
  }

  if (loading) return <main className="cart-page"><div className="loading-card">Actualizando disponibilidad…</div></main>;
  if (!products.length) return <main className="cart-page"><section className="empty-cart"><span>Tu carrito</span><h1>Todavía no agregaste artículos.</h1><p>Explorá el catálogo y elegí artículos para una compra inmediata o una reserva.</p><a className="primary-action" href="/#articulos">Ver artículos</a></section></main>;

  return <main className="cart-page">
    <div className="page-heading"><span className="section-kicker">TU SELECCIÓN</span><h1>Carrito</h1><p>Revisá cuánto pagás ahora y qué saldo queda para el retiro.</p></div>
    <div className="cart-layout">
      <section className="cart-items" aria-label="Artículos en el carrito">
        {products.map((product) => {
          const due = dueNowForProduct(product);
          return <article key={product.id}>
            <img src={product.images[0]} alt="" />
            <div className="cart-item-main"><span className={product.saleMode === 'IMMEDIATE' ? 'status-now' : 'status-later'}>{product.saleMode === 'IMMEDIATE' ? 'DISPONIBLE AHORA' : 'RETIRO POSTERIOR'}</span><h2>{itemTitle(product)}</h2><p>{product.condition}</p>{(product.quantityTotal ?? 1) > 1 ? <label>Cantidad <select value={cart.quantities[product.id] ?? 1} onChange={(e) => cart.setQuantity(product.id, Number(e.target.value))}>{Array.from({ length: Math.max(0, product.quantityRemaining ?? 0) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label> : null}<button type="button" onClick={() => cart.remove(product.id)}>Quitar</button></div>
            <dl><div><dt>Precio{(product.quantityTotal ?? 1) > 1 ? ' por unidad' : ''}</dt><dd>{formatPYG(product.askingPricePYG)}</dd></div><div className="highlight"><dt>A pagar ahora</dt><dd>{formatPYG(due * (cart.quantities[product.id] ?? 1))}</dd></div>{product.askingPricePYG > due ? <><div><dt>Saldo al retirar</dt><dd>{formatPYG((product.askingPricePYG - due) * (cart.quantities[product.id] ?? 1))}</dd></div><div><dt>Ventana de retiro</dt><dd>{formatPickupWindow(product.pickupWindowStart, product.pickupWindowEnd, product.pickupAvailableDate)}</dd></div></> : null}</dl>
          </article>;
        })}
      </section>
      <aside className="cart-summary">
        <span className="section-kicker">RESUMEN</span><h2>Lo que vas a pagar</h2>
        <dl><div><dt>Valor total de los artículos</dt><dd>{formatPYG(totals.total)}</dd></div><div className="summary-due"><dt>A pagar ahora</dt><dd>{formatPYG(totals.due)}</dd></div><div><dt>Saldo futuro</dt><dd>{formatPYG(totals.balance)}</dd></div></dl>
        {totals.balance > 0 ? <p>El saldo futuro se paga al retirar los artículos con fecha posterior.</p> : null}
        <div className="pickup-confirm"><strong>Retiro únicamente</strong><span>No ofrecemos delivery ni envíos.</span></div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-action" type="button" onClick={beginCheckout} disabled={submitting || products.some((product) => product.status !== 'AVAILABLE')}>{submitting ? 'Protegiendo tus artículos…' : 'Continuar y reservar por 15 minutos'}</button>
        <small>Al continuar, el inventario se retiene temporalmente en el servidor para evitar una doble venta.</small>
      </aside>
    </div>
  </main>;
}
