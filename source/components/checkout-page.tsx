'use client';

import { useEffect, useMemo, useState } from 'react';
import { PUBLIC_CONFIG } from '@/lib/config';
import type { OrderSummary } from '@/lib/types';
import { formatItemNumber, formatPickupWindow, formatPYG } from '@/lib/types';

type Bank = { bankName: string; accountHolder: string; accountType: string; accountNumberOrAlias: string; sellerIdReference: string };

export function CheckoutPage({ orderId, token }: { orderId: string; token: string }) {
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [transferChecked, setTransferChecked] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState({ name: '', whatsapp: '', email: '', pickup: false, delayed: false, deposit: false });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    fetch(`/api/checkout/order?id=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then((data) => { setOrder(data.order); if (data.bank) setBank(data.bank); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'No se pudo cargar el pedido.'))
      .finally(() => setLoading(false));
  }, [orderId, token]);

  const hasDelayed = order?.items.some((item) => item.saleMode === 'DELAYED') ?? false;
  const secondsLeft = useMemo(() => order?.holdExpiresAt ? Math.max(0, Math.ceil((order.holdExpiresAt - now) / 1000)) : 0, [order?.holdExpiresAt, now]);
  const timeLeft = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;

  async function submitDetails(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/checkout/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId, token, name: form.name, whatsapp: form.whatsapp, email: form.email, pickupAcknowledged: form.pickup, delayedPickupAcknowledged: form.delayed, depositTermsAcknowledged: form.deposit }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setOrder(data.order); setBank(data.bank);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo continuar.'); }
    finally { setBusy(false); }
  }

  async function confirmTransfer() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/checkout/transfer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId, token }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); setOrder(data.order);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo confirmar.'); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="checkout-page"><div className="loading-card">Preparando tu checkout seguro…</div></main>;
  if (!order) return <main className="checkout-page"><div className="empty-cart"><h1>No encontramos este pedido.</h1><p>{error}</p><a href="/">Volver al catálogo</a></div></main>;
  if (order.status === 'EXPIRED' || (order.status === 'TEMPORARY_HOLD' && secondsLeft === 0)) return <main className="checkout-page"><div className="empty-cart"><span>La retención terminó</span><h1>Estos artículos volvieron a estar disponibles.</h1><p>Volvé al catálogo y agregalos otra vez para iniciar un nuevo plazo de 15 minutos.</p><a className="primary-action" href="/#articulos">Volver al catálogo</a></div></main>;

  const done = Boolean(order.transferDeclaredAt);
  const paymentStep = Boolean(order.buyerName);
  const proofBase = PUBLIC_CONFIG.whatsappNumber.replace(/\D/g, '') ? `https://wa.me/${PUBLIC_CONFIG.whatsappNumber.replace(/\D/g, '')}` : 'https://wa.me/';
  const orderedItems = order.items.map((item) => item.itemNumber == null ? item.title : formatItemNumber(item.itemNumber)).join(', ');
  const proofHref = `${proofBase}?text=${encodeURIComponent(`Hola, hice una transferencia por el pedido ${order.reference} (${orderedItems}). Adjunto el comprobante.`)}`;

  return <main className="checkout-page">
    <div className="checkout-top"><div><span className="section-kicker">PAGO POR TRANSFERENCIA</span><h1>{done ? 'Transferencia informada' : paymentStep ? 'Datos para transferir' : 'Confirmá tus datos'}</h1></div><div className="order-reference"><span>Pedido</span><strong>{order.reference}</strong></div></div>
    <div className="checkout-progress" aria-label="Progreso"><span className="done">1. Carrito</span><span className={paymentStep ? 'done' : 'active'}>2. Datos</span><span className={paymentStep ? 'active' : ''}>3. Transferencia</span><span className={done ? 'active' : ''}>4. Confirmación</span></div>

    <div className="checkout-layout">
      <section>
        {!paymentStep ? <form className="buyer-form" onSubmit={submitDetails}>
          <div className="hold-timer"><span>Retención temporal del inventario</span><strong>{timeLeft}</strong></div>
          <p>Durante este plazo nadie más puede iniciar una compra de estos artículos. La reserva final depende de que confirmemos tu transferencia.</p>
          <label>Nombre y apellido<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="name" /></label>
          <label>Número de WhatsApp / celular<input required value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} inputMode="tel" autoComplete="tel" placeholder="Ej. 0981 123 456" /></label>
          <label>Email <span>(opcional)</span><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" autoComplete="email" /></label>
          <fieldset><legend>Antes de continuar</legend><label className="check-row"><input type="checkbox" checked={form.pickup} onChange={(event) => setForm({ ...form, pickup: event.target.checked })} /><span>Entiendo que todos los artículos son para retiro personal en {PUBLIC_CONFIG.pickupArea}; no hay delivery ni envíos.</span></label>{hasDelayed ? <label className="check-row"><input type="checkbox" checked={form.delayed} onChange={(event) => setForm({ ...form, delayed: event.target.checked })} /><span>Entiendo que los artículos con retiro posterior solo se pueden retirar desde la fecha indicada.</span></label> : null}<label className="check-row"><input type="checkbox" checked={form.deposit} onChange={(event) => setForm({ ...form, deposit: event.target.checked })} /><span>Entiendo que el artículo queda reservado o vendido únicamente después de que el vendedor confirme el pago.</span></label></fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-action" disabled={busy || !form.pickup || !form.deposit || (hasDelayed && !form.delayed)}>{busy ? 'Guardando…' : 'Ver datos de transferencia'}</button>
        </form> : done ? <div className="confirmation-card"><span className="confirmation-mark">✓</span><span className="section-kicker">REFERENCIA {order.reference}</span><h2>Recibimos tu aviso de transferencia.</h2><p>Tu pago todavía debe ser verificado. El vendedor revisará el ingreso y confirmará el pedido manualmente.</p><a className="primary-action" href={proofHref} target="_blank" rel="noreferrer">Enviar comprobante por WhatsApp</a><a className="text-action" href="/">Volver al catálogo</a></div> : <div className="bank-panel">
          <div className="hold-timer"><span>Pedido pendiente de confirmación manual</span><strong>{order.reference}</strong></div>
          <div className="bank-warning"><strong>Datos de demostración</strong><p>No transfieras dinero real. Estos campos se reemplazarán por información privada en la siguiente fase.</p></div>
          <h2>Transferí exactamente {formatPYG(order.dueNowPYG)}</h2><p>Usá la referencia <strong>{order.reference}</strong> en el concepto o mensaje de la transferencia.</p>
          <dl><div><dt>Banco</dt><dd>{bank?.bankName}</dd></div><div><dt>Titular</dt><dd>{bank?.accountHolder}</dd></div><div><dt>Tipo de cuenta</dt><dd>{bank?.accountType}</dd></div><div><dt>Número o alias</dt><dd>{bank?.accountNumberOrAlias}</dd></div><div><dt>Referencia de CI/RUC</dt><dd>{bank?.sellerIdReference}</dd></div></dl>
          <a className="primary-action" href={proofHref} target="_blank" rel="noreferrer">Enviar comprobante por WhatsApp</a>
          <label className="check-row transfer-check"><input type="checkbox" checked={transferChecked} onChange={(event) => setTransferChecked(event.target.checked)} /><span>Confirmo que realicé la transferencia por {formatPYG(order.dueNowPYG)}.</span></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-action" type="button" disabled={busy || !transferChecked} onClick={confirmTransfer}>{busy ? 'Actualizando…' : 'Ya hice la transferencia'}</button>
          <small>Mandá el comprobante por WhatsApp. El vendedor verificará el dinero manualmente. Este botón no confirma la reserva por sí solo.</small>
        </div>}
      </section>

      <aside className="checkout-summary"><span className="section-kicker">PEDIDO {order.reference}</span><h2>Resumen</h2>{order.items.map((item) => <article key={item.id}><img src={item.image} alt="" /><div><strong>{item.itemNumber == null ? item.title : `${formatItemNumber(item.itemNumber)} — ${item.title}`}</strong><span>{item.saleMode === 'DELAYED' ? `Reserva ${item.depositPercent}% · Retiro ${formatPickupWindow(item.pickupWindowStart, item.pickupWindowEnd, item.pickupAvailableDate)}` : 'Disponible ahora'}</span></div><b>{formatPYG(item.dueNowPYG)}</b></article>)}<dl><div><dt>Valor total</dt><dd>{formatPYG(order.totalValuePYG)}</dd></div><div className="summary-due"><dt>A pagar ahora</dt><dd>{formatPYG(order.dueNowPYG)}</dd></div><div><dt>Saldo al retirar</dt><dd>{formatPYG(order.balanceLaterPYG)}</dd></div></dl></aside>
    </div>
  </main>;
}
