'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AdminProduct, InventoryAuditEntry, InventorySnapshotSummary, InventoryStatus, OrderAuditEntry, OrderSummary } from '@/lib/types';
import { dueNowForProduct, formatItemNumber, formatPickupDate, formatPickupWindow, formatPYG, itemTitle, statusLabel } from '@/lib/types';
import { ImageLightbox, ProductImageGallery } from '@/components/image-lightbox';
import { EnglishHelper } from '@/components/admin-language';

type Snapshot = { stats: Record<string, number>; orders: OrderSummary[]; products: AdminProduct[]; role: 'OWNER' | 'REVIEWER' };
type Tab = 'overview' | 'batch' | 'orders' | 'direct' | 'inventory' | 'pricing' | 'safety' | 'access';
type PaymentDetails = { amountReceived?: number; paymentMethod?: string };
type ReviewerAccessStatus = { hasActiveSession: boolean; activeSessionCount: number; latestSessionExpiresAt: number | null; hasActiveCode: boolean; activeCodeExpiresAt: number | null };
const STATUSES: InventoryStatus[] = ['AVAILABLE', 'TEMPORARY_HOLD', 'PAYMENT_PENDING', 'RESERVED', 'SOLD', 'PICKED_UP', 'NEEDS_REVIEW', 'UNLISTED'];
const ORDER_STATUS_LABELS: Record<string, string> = {
  TEMPORARY_HOLD: 'Retención temporal', PAYMENT_PENDING: 'Pago a confirmar', PAYMENT_CONFIRMED: 'Seña o pago confirmado',
  BALANCE_CONFIRMED: 'Saldo confirmado', PICKED_UP: 'Retirado', CANCELLED: 'Cancelado', EXPIRED: 'Vencido',
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`El servidor devolvió una respuesta no válida (${response.status}). Intentá de nuevo.`);
  }
  return response.json() as Promise<T>;
}

export function AdminDashboard({ sellerName, sellerEmail, role }: { sellerName: string; sellerEmail: string; role: 'OWNER' | 'REVIEWER' }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>(role === 'REVIEWER' ? 'batch' : 'overview');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [adminGallery, setAdminGallery] = useState<{ images: string[]; title: string; index: number } | null>(null);

  async function refresh() {
    setError('');
    try {
      const response = await fetch('/api/admin/snapshot', { cache: 'no-store' });
      const data = await readJsonResponse<Snapshot & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error);
      setSnapshot(data);
    } catch (reason) {
      setSnapshot(null);
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar el panel.');
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function orderAction(orderId: string, action: string, details: PaymentDetails = {}) {
    setBusy(`${orderId}-${action}`); setError('');
    try {
      const response = await fetch('/api/admin/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId, action, ...details }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo actualizar.'); }
    finally { setBusy(''); }
  }

  async function logoutReviewer() {
    setBusy('logout');
    try {
      await fetch('/api/reviewer-access', { method: 'DELETE' });
    } finally {
      window.location.assign('/admin');
    }
  }

  const pending = snapshot?.orders.filter((order) => order.status === 'PAYMENT_PENDING') ?? [];
  const totalProducts = snapshot?.products.length ?? 0;

  function openAdminImage(event: React.MouseEvent<HTMLElement>) {
    const image = (event.target as HTMLElement).closest('img');
    if (!image || image.closest('.review-gallery, .photo-review-gallery, .buyer-preview, .image-lightbox')) return;
    if (image.closest('summary')) {
      event.preventDefault();
      event.stopPropagation();
    }
    const product = snapshot?.products.find((candidate) => candidate.images.includes(image.src) || candidate.images.some((source) => image.src.endsWith(source)));
    if (product) {
      const index = Math.max(0, product.images.findIndex((source) => image.src.endsWith(source) || source === image.src));
      setAdminGallery({ images: product.images, title: itemTitle(product), index });
      return;
    }
    if (image.src) setAdminGallery({ images: [image.src], title: image.alt || 'Fotografía del producto', index: 0 });
  }

  return <main className="admin-shell" onClick={openAdminImage}>
    <header className="admin-header"><div><span className="admin-demo">{role === 'OWNER' ? 'PANEL DEL PROPIETARIO' : 'REVISIÓN DE INVENTARIO'}</span><h1>Venta de mudanza</h1><p>Hola, {sellerName}. {role === 'OWNER' ? 'Gestioná la venta y la revisión.' : 'Revisá los artículos pendientes, incluidos los agregados después del lote inicial.'}</p></div><div className="admin-account"><strong>{role === 'OWNER' ? 'OWNER' : 'REVIEWER'}</strong><span>{sellerEmail}</span>{role === 'OWNER' ? <a href="/signout-with-chatgpt?return_to=%2F">Cerrar sesión</a> : <button disabled={busy === 'logout'} onClick={() => void logoutReviewer()}>{busy === 'logout' ? 'Cerrando…' : 'Cerrar sesión'}</button>}</div></header>
    <section className="admin-demo-notice"><strong>Configuración de demostración.</strong> El banco, la cuenta y el número de WhatsApp todavía son campos de muestra. No los uses para operaciones reales.</section>
    <nav className="admin-tabs" aria-label="Secciones del panel">
      {role === 'OWNER' ? <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Resumen</button> : null}
      <button className={tab === 'batch' ? 'active' : ''} onClick={() => setTab('batch')}>Revisión de fotos <span>{totalProducts}</span></button>
      {role === 'OWNER' ? <><button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Pedidos <span>{pending.length}</span></button><button className={tab === 'direct' ? 'active' : ''} onClick={() => setTab('direct')}>Registrar venta directa</button><button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>Inventario <span>{totalProducts}</span></button><button className={tab === 'pricing' ? 'active' : ''} onClick={() => setTab('pricing')}>Precios</button><button className={tab === 'safety' ? 'active' : ''} onClick={() => setTab('safety')}>Backup e historial</button><button className={tab === 'access' ? 'active' : ''} onClick={() => setTab('access')}>Acceso revisor</button></> : null}
      <a href="/" target="_blank">Ver sitio público ↗</a>
    </nav>
    {error ? <div className="admin-error" role="alert"><p>{error}</p><button type="button" onClick={() => void refresh()}>Reintentar</button></div> : null}
    {!snapshot && !error ? <div className="loading-card">Cargando el movimiento de la venta…</div> : null}
    {snapshot && tab === 'overview' ? <Overview snapshot={snapshot} pending={pending} setTab={setTab} onAction={orderAction} busy={busy} /> : null}
    {snapshot && tab === 'batch' ? <PhotoReview products={snapshot.products} onRefresh={refresh} /> : null}
    {snapshot && tab === 'orders' ? <Orders orders={snapshot.orders} onAction={orderAction} busy={busy} /> : null}
    {snapshot && tab === 'direct' && role === 'OWNER' ? <DirectSale products={snapshot.products} onDone={refresh} /> : null}
    {snapshot && tab === 'inventory' ? <InventoryCatalog products={snapshot.products} onRefresh={refresh} setBusy={setBusy} busy={busy} /> : null}
    {snapshot && tab === 'pricing' ? <Pricing products={snapshot.products} /> : null}
    {snapshot && tab === 'safety' && role === 'OWNER' ? <OwnerSafety onRefresh={refresh} /> : null}
    {snapshot && tab === 'access' && role === 'OWNER' ? <ReviewerAccess /> : null}
    {adminGallery ? <ImageLightbox images={adminGallery.images} title={adminGallery.title} initialIndex={adminGallery.index} onClose={() => setAdminGallery(null)} /> : null}
  </main>;
}

function BatchReview({ products, onRefresh, setBusy, busy, role }: { products: AdminProduct[]; onRefresh: () => Promise<void>; setBusy: (value: string) => void; busy: string; role: 'OWNER' | 'REVIEWER' }) {
  const batchProducts = products.filter((product) => product.needsReview || product.status === 'NEEDS_REVIEW').sort((a, b) => (a.itemNumber ?? 999) - (b.itemNumber ?? 999));
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [jump, setJump] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [reviewImageIndex, setReviewImageIndex] = useState<number | null>(null);
  const currentIndex = Math.min(index, Math.max(batchProducts.length - 1, 0));
  const product = batchProducts[currentIndex];
  const complete = batchProducts.filter((candidate) => candidate.expectedPhotoCount ? (candidate.uploadedPhotoCount ?? 0) >= candidate.expectedPhotoCount : candidate.images.length > 0 && candidate.images[0] !== '/photo-pending.svg');
  const normalizedSearch = search.trim().toLowerCase();
  const searchResults = normalizedSearch ? batchProducts.filter((candidate) => {
    const numeric = normalizedSearch.replace(/^item\s*/i, '').replace(/^0+/, '');
    const exactItem = /^\d+$/.test(numeric) && candidate.itemNumber === Number(numeric);
    const haystack = `${formatItemNumber(candidate.itemNumber)} ${candidate.title} ${candidate.category} ${candidate.tags.join(' ')} ${candidate.description}`.toLowerCase();
    return exactItem || haystack.includes(normalizedSearch);
  }).slice(0, 8) : [];

  function goToItem(value: string) {
    const numeric = value.trim().toLowerCase().replace(/^item\s*/i, '').replace(/^0+/, '');
    const itemNumber = Number(numeric);
    const target = batchProducts.findIndex((candidate) => candidate.itemNumber === itemNumber);
    if (!Number.isInteger(itemNumber) || target < 0) { setError('No encontramos ese Item en la cola de revisión.'); return; }
    setError(''); setEditing(false); setPreviewing(false); setReviewImageIndex(null); setIndex(target); setSearch(''); setJump('');
  }

  async function prepare() {
    setBusy('prepare-batch'); setError('');
    try {
      const response = await fetch('/api/admin/batches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'prepare' }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo preparar el lote.'); }
    finally { setBusy(''); }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy('upload-batch'); setError('');
    let uploaded = 0;
    try {
      for (const file of Array.from(files)) {
        setUploadStatus(`Subiendo ${uploaded + 1} de ${files.length}: ${file.name}`);
        const form = new FormData(); form.append('file', file);
        const response = await fetch('/api/admin/batches/upload', { method: 'POST', body: form });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        uploaded += 1;
      }
      setUploadStatus(`${uploaded} fotos protegidas cargadas correctamente.`);
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron subir todas las fotos.'); }
    finally { setBusy(''); }
  }

  async function approveCurrent() {
    if (!product) return;
    setBusy('approve-batch'); setError('');
    try {
      const response = await fetch('/api/admin/batches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve', productIds: [product.id] }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setEditing(false); setPreviewing(false); setReviewImageIndex(null); setIndex(Math.min(currentIndex + 1, batchProducts.length - 1)); await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo aprobar este artículo.'); }
    finally { setBusy(''); }
  }

  if (!batchProducts.length) return <section className="admin-content batch-empty"><span className="section-kicker">REVISIÓN PRIVADA</span><h2>No hay artículos pendientes</h2><p>Los artículos nuevos, incluidos los agregados por separado del lote inicial, aparecen aquí cuando requieren revisión. Nada se publica sin aprobación individual.</p>{role === 'OWNER' ? <button className="admin-primary" disabled={Boolean(busy)} onClick={prepare}>{busy === 'prepare-batch' ? 'Preparando…' : 'Aplicar correcciones base'}</button> : null}{error ? <p className="form-error">{error}</p> : null}</section>;

  return <section className="admin-content batch-review"><div className="admin-section-heading"><div><span className="section-kicker">REVISIÓN SECUENCIAL</span><h2>Un artículo por vez</h2><p>La cola reúne el lote inicial y los artículos agregados después. Nada se publica sin aprobación individual.</p></div>{role === 'OWNER' ? <div className="heading-actions"><button onClick={() => void prepare()} disabled={Boolean(busy)}>{busy === 'prepare-batch' ? 'Aplicando…' : 'Aplicar correcciones base'}</button><label className="upload-button"><input type="file" accept="image/jpeg,.jpg,.jpeg" multiple onChange={(event) => void upload(event.target.files)} disabled={Boolean(busy)} />{busy === 'upload-batch' ? 'Subiendo…' : 'Cargar fotos'}</label></div> : null}</div>
    <div className="admin-item-search"><label>Buscar Item, nombre o categoría…<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. Item 002, dispenser o Cocina" /></label><form onSubmit={(event) => { event.preventDefault(); goToItem(jump); }}><label>Ir al Item:<input value={jump} onChange={(event) => setJump(event.target.value)} inputMode="numeric" placeholder="002" /></label><button>Ir</button></form>{searchResults.length ? <div className="admin-search-results">{searchResults.map((candidate) => <button key={candidate.id} onClick={() => goToItem(String(candidate.itemNumber))}><strong>{formatItemNumber(candidate.itemNumber)}</strong><span>{candidate.title} · {candidate.category}</span></button>)}</div> : null}</div>
    <div className="batch-stats"><article><strong>{batchProducts.length}</strong><span>pendientes de revisión</span></article><article><strong>{batchProducts.filter((candidate) => !candidate.batchId).length}</strong><span>agregados después</span></article><article><strong>{batchProducts.filter((candidate) => candidate.reviewFlag).length}</strong><span>preguntas abiertas</span></article><article><strong>{complete.length}/{batchProducts.length}</strong><span>con fotos completas</span></article></div>
    <div className="batch-privacy"><strong>Revisión privada.</strong><span>Las fotos originales se conservan; aprobar este artículo es la única acción que lo publica.</span></div>
    {uploadStatus ? <p className="upload-status">{uploadStatus}</p> : null}{error ? <p className="form-error">{error}</p> : null}
    <div className="review-position"><strong>{formatItemNumber(product.itemNumber)} de {batchProducts.length}</strong><span>Posición {currentIndex + 1} de {batchProducts.length}</span></div>
    <article className={`sequential-review ${product.reviewFlag ? 'has-flag' : ''}`}>
      <section className="public-review-section" aria-labelledby={`public-${product.id}`}>
        <div className="review-section-heading"><div><span className="field-visibility public">Público</span><h3 id={`public-${product.id}`}>Información pública</h3><p>¿Es esto exactamente lo que queremos que vea el comprador?</p></div><button className="buyer-preview-button" onClick={() => setPreviewing(true)}>Vista previa como comprador</button></div>
        <div className="review-gallery"><button className="review-primary-photo-button" type="button" onClick={() => setReviewImageIndex(0)} aria-label={`Ampliar foto principal de ${product.title}`}><img className="review-primary-photo" src={product.images[0]} alt={itemTitle(product)} /><span className="image-enlarge-hint">Ampliar foto</span></button><div className="review-thumbnails">{product.images.slice(1).map((image, photoIndex) => <button type="button" key={image} onClick={() => setReviewImageIndex(photoIndex + 1)} aria-label={`Ampliar foto ${photoIndex + 2} de ${product.title}`}><img src={image} alt={`${itemTitle(product)}, foto ${photoIndex + 2}`} /></button>)}</div><p>Foto principal + {Math.max(product.images.length - 1, 0)} foto(s) pública(s) adicional(es)</p></div>
        <div className="review-details"><div className="batch-title"><span className={`order-status ${product.status.toLowerCase()}`}>{statusLabel(product.status)}</span><h4>{product.title}</h4></div>
          <EnglishHelper product={product} />
          {editing ? <PhotoReplacement product={product} onRefresh={onRefresh} /> : null}
          <dl className="review-fields public-fields"><div><dt>Item ID</dt><dd>{formatItemNumber(product.itemNumber)}</dd></div><div><dt>Categoría</dt><dd>{product.category}</dd></div><div><dt>Precio pedido</dt><dd>{formatPYG(product.askingPricePYG)}</dd></div>{product.originalPricePYG ? <div><dt>Precio anterior visible</dt><dd>{formatPYG(product.originalPricePYG)}</dd></div> : null}<div className="wide"><dt>Descripción pública</dt><dd>{product.description}</dd></div><div className="wide public-exclusions"><dt>Objetos visibles no incluidos</dt><dd>{publicExclusions(product.description)}</dd></div><div><dt>Estado / condición</dt><dd>{product.condition}</dd></div><div className="wide"><dt>Funcionamiento y observaciones públicas</dt><dd>{product.conditionNotes || 'Sin observaciones adicionales'}</dd></div><div className="wide"><dt>Defectos conocidos públicos</dt><dd>{product.knownDefects || 'Ninguno informado'}</dd></div><div className="wide"><dt>Incluye</dt><dd>{product.includedAccessories.length ? product.includedAccessories.join(' · ') : 'Ningún accesorio indicado'}</dd></div><div><dt>Modalidad de venta</dt><dd>{product.saleMode === 'DELAYED' ? 'Reserva y retiro posterior' : 'Pago completo y retiro inmediato'}</dd></div><div><dt>Retiro</dt><dd>{product.saleMode === 'DELAYED' ? formatPickupWindow(product.pickupWindowStart, product.pickupWindowEnd, product.pickupAvailableDate) : 'Disponible después de confirmar el pago'}</dd></div>{product.saleMode === 'DELAYED' ? <div><dt>Seña / reserva</dt><dd>{product.depositPercent}%</dd></div> : null}<div className="wide"><dt>Logística pública</dt><dd>{publicLogistics(product).join(' · ') || 'Sin indicaciones especiales'}</dd></div><div className="wide"><dt>Etiquetas públicas</dt><dd><span className="public-tag-list">{product.tags.length ? product.tags.map((tag) => <span key={tag}>{tag}</span>) : 'Sin etiquetas'}</span></dd></div></dl>
          {editing ? <CompleteProductEditor key={product.id} product={product} role={role} onRefresh={async () => { setEditing(false); await onRefresh(); }} setBusy={setBusy} busy={busy} /> : null}
        </div>
      </section>
      <InternalProductDetails key={product.id} product={product} />
    </article>
    {previewing ? <BuyerPreview product={product} onClose={() => setPreviewing(false)} /> : null}
    {reviewImageIndex !== null ? <ImageLightbox images={product.images} title={itemTitle(product)} initialIndex={reviewImageIndex} onClose={() => setReviewImageIndex(null)} /> : null}
    <div className="review-actions"><button disabled={currentIndex === 0 || Boolean(busy)} onClick={() => { setEditing(false); setPreviewing(false); setReviewImageIndex(null); setIndex(currentIndex - 1); }}>← Anterior</button><button disabled={Boolean(busy)} onClick={() => setEditing(!editing)}>{editing ? 'Cerrar edición' : 'Editar'}</button><button disabled={currentIndex === batchProducts.length - 1 || Boolean(busy)} onClick={() => { setEditing(false); setPreviewing(false); setReviewImageIndex(null); setIndex(currentIndex + 1); }}>Revisar después / Siguiente →</button><button className="admin-primary" disabled={Boolean(busy) || product.status !== 'NEEDS_REVIEW'} onClick={() => void approveCurrent()}>{busy === 'approve-batch' ? 'Aprobando…' : product.status === 'NEEDS_REVIEW' ? 'Aprobar y continuar' : 'Ya aprobado'}</button></div>
  </section>;
}

function PhotoReview({ products, onRefresh }: { products: AdminProduct[]; onRefresh: () => Promise<void> }) {
  const sortedProducts = [...products].sort((a, b) => (a.itemNumber ?? 999) - (b.itemNumber ?? 999));
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(sortedProducts[0]?.id ?? '');
  const [lightbox, setLightbox] = useState<{ product: AdminProduct; index: number } | null>(null);
  const query = search.trim().toLowerCase();
  const visible = query ? sortedProducts.filter((product) => `${formatItemNumber(product.itemNumber)} ${product.title} ${product.category} ${product.tags.join(' ')}`.toLowerCase().includes(query)) : sortedProducts;
  const activeId = visible.some((product) => product.id === openId) ? openId : '';

  return <section className="admin-content photo-review"><div className="admin-section-heading"><div><span className="section-kicker">SOLO FOTOS</span><h2>Revisión de Fotos</h2><p>Todos los artículos están aquí para agregar, reemplazar o revisar fotografías. Los datos del catálogo se administran en Inventario.</p></div><strong className="photo-review-count">{visible.length} de {sortedProducts.length} artículos</strong></div>
    <div className="photo-review-search"><label>Buscar Item, nombre o categoría…<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. Item 057, mesa o Muebles" /></label></div>
    {visible.length ? <div className="photo-review-list">{visible.map((product) => <article className={`photo-review-item ${activeId === product.id ? 'is-open' : ''}`} key={product.id}><header><div className="photo-review-heading"><span className="photo-review-item-number">{formatItemNumber(product.itemNumber)}</span><div><span className={`order-status ${product.status.toLowerCase()}`}>{statusLabel(product.status)}</span><h3>{product.title}</h3><p>{product.category} · {product.images.length} foto(s) · {product.quantityTotal ?? 1} unidad(es)</p></div></div><button type="button" className="admin-primary" onClick={() => setOpenId(activeId === product.id ? '' : product.id)}>{activeId === product.id ? 'Cerrar fotos' : 'Administrar fotos'}</button></header>{activeId === product.id ? <div className="photo-review-body"><div className="photo-review-gallery">{product.images.map((image, index) => <button type="button" key={`${image}-${index}`} onClick={() => setLightbox({ product, index })} aria-label={`Ampliar foto ${index + 1} de ${itemTitle(product)}`}><img src={image} alt={`${itemTitle(product)}, foto ${index + 1}`} /><span>{index === 0 ? 'Principal' : `Foto ${index + 1}`}</span></button>)}</div><PhotoReplacement product={product} onRefresh={onRefresh} /></div> : null}</article>)}</div> : <div className="admin-empty">No encontramos artículos con esa búsqueda.</div>}
    {lightbox ? <ImageLightbox images={lightbox.product.images} title={itemTitle(lightbox.product)} initialIndex={lightbox.index} onClose={() => setLightbox(null)} /> : null}
  </section>;
}

function InventoryCatalog({ products, onRefresh, setBusy, busy }: { products: AdminProduct[]; onRefresh: () => Promise<void>; setBusy: (value: string) => void; busy: string }) {
  const [filter, setFilter] = useState('ALL');
  const [showAdd, setShowAdd] = useState(false);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [search, setSearch] = useState('');
  const [jump, setJump] = useState('');
  const [error, setError] = useState('');
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const catalog = products.filter((product) => filter === 'ALL' || product.status === filter || (filter === 'REVIEW' && product.needsReview)).sort((a, b) => (a.itemNumber ?? 999) - (b.itemNumber ?? 999));
  const query = search.trim().toLowerCase();
  const searched = query ? catalog.filter((product) => `${formatItemNumber(product.itemNumber)} ${product.title} ${product.category} ${product.tags.join(' ')} ${product.description}`.toLowerCase().includes(query)) : catalog;
  const currentIndex = Math.min(index, Math.max(searched.length - 1, 0));
  const product = searched[currentIndex];
  const searchResults = query ? searched.slice(0, 8) : [];

  function goToItem(value: string) {
    const numeric = value.trim().toLowerCase().replace(/^item\s*/i, '').replace(/^0+/, '');
    const itemNumber = Number(numeric);
    const target = catalog.findIndex((candidate) => candidate.itemNumber === itemNumber);
    if (!Number.isInteger(itemNumber) || target < 0) { setError('No encontramos ese Item en el catálogo.'); return; }
    setError(''); setEditing(false); setPreviewing(false); setImageIndex(null); setSearch(''); setJump(''); setIndex(target);
  }

  return <section className="admin-content inventory-catalog"><div className="admin-section-heading"><div><span className="section-kicker">CATÁLOGO COMPLETO</span><h2>Inventario</h2><p>Esta es la vista administrativa completa del catálogo. Aquí podés verificar la ficha, editar todos los campos y administrar sus fotos.</p></div><div className="heading-actions"><select value={filter} onChange={(event) => { setFilter(event.target.value); setIndex(0); setEditing(false); }}><option value="ALL">Todos los artículos</option><option value="AVAILABLE">Disponibles</option><option value="PAYMENT_PENDING">Pago pendiente</option><option value="RESERVED">Reservados</option><option value="SOLD">Vendidos</option><option value="PICKED_UP">Retirados</option><option value="REVIEW">Requieren revisión</option><option value="UNLISTED">No publicados</option></select><button className="admin-primary" onClick={() => setShowAdd(!showAdd)}>+ Agregar artículo</button></div></div>{showAdd ? <AddProduct onDone={async () => { setShowAdd(false); await onRefresh(); }} /> : null}
    <div className="admin-item-search"><label>Buscar Item, nombre o categoría…<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. Item 057, mesa o Muebles" /></label><form onSubmit={(event) => { event.preventDefault(); goToItem(jump); }}><label>Ir al Item:<input value={jump} onChange={(event) => setJump(event.target.value)} inputMode="numeric" placeholder="057" /></label><button>Ir</button></form>{searchResults.length ? <div className="admin-search-results">{searchResults.map((candidate) => <button type="button" key={candidate.id} onClick={() => goToItem(String(candidate.itemNumber))}><strong>{formatItemNumber(candidate.itemNumber)}</strong><span>{candidate.title} · {candidate.category}</span></button>)}</div> : null}</div>
    {product ? <>
    <div className="catalog-position"><strong>{formatItemNumber(product.itemNumber)} de {products.length}</strong><span>Posición {currentIndex + 1} de {searched.length} · {product.quantityRemaining ?? 0} disponible(s)</span></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <article className={`sequential-review catalog-review ${product.reviewFlag ? 'has-flag' : ''}`}><section className="public-review-section" aria-labelledby={`catalog-${product.id}`}><div className="review-section-heading"><div><span className="field-visibility public">Catálogo</span><h3 id={`catalog-${product.id}`}>Ficha completa del artículo</h3><p>Vista administrativa del anuncio y de todos los datos que puede ver el comprador.</p></div><button className="buyer-preview-button" onClick={() => setPreviewing(true)}>Vista previa como comprador</button></div><div className="review-gallery"><button className="review-primary-photo-button" type="button" onClick={() => setImageIndex(0)} aria-label={`Ampliar foto principal de ${product.title}`}><img className="review-primary-photo" src={product.images[0]} alt={itemTitle(product)} /><span className="image-enlarge-hint">Ampliar foto</span></button><div className="review-thumbnails">{product.images.slice(1).map((image, photoIndex) => <button type="button" key={`${image}-${photoIndex}`} onClick={() => setImageIndex(photoIndex + 1)} aria-label={`Ampliar foto ${photoIndex + 2} de ${product.title}`}><img src={image} alt={`${itemTitle(product)}, foto ${photoIndex + 2}`} /></button>)}</div><p>Foto principal + {Math.max(product.images.length - 1, 0)} foto(s) pública(s) adicional(es)</p></div><div className="review-details"><div className="batch-title"><span className={`order-status ${product.status.toLowerCase()}`}>{statusLabel(product.status)}</span><h4>{formatItemNumber(product.itemNumber)} · {product.title}</h4></div><EnglishHelper product={product} /><PublicReviewFields product={product} />{editing ? <CompleteProductEditor key={product.id} product={product} role="OWNER" includePhotos onRefresh={async () => { setEditing(false); await onRefresh(); }} setBusy={setBusy} busy={busy} /> : null}</div></section><InternalProductDetails key={product.id} product={product} /></article>
    {previewing ? <BuyerPreview product={product} onClose={() => setPreviewing(false)} /> : null}{imageIndex !== null ? <ImageLightbox images={product.images} title={itemTitle(product)} initialIndex={imageIndex} onClose={() => setImageIndex(null)} /> : null}<div className="review-actions"><button disabled={currentIndex === 0 || Boolean(busy)} onClick={() => { setEditing(false); setPreviewing(false); setImageIndex(null); setIndex(currentIndex - 1); }}>← Anterior</button><button disabled={Boolean(busy)} onClick={() => setEditing(!editing)}>{editing ? 'Cerrar edición' : 'Editar ficha y fotos'}</button><button disabled={currentIndex === searched.length - 1 || Boolean(busy)} onClick={() => { setEditing(false); setPreviewing(false); setImageIndex(null); setIndex(currentIndex + 1); }}>Siguiente →</button></div>
    </> : <div className="admin-empty inventory-no-results"><strong>{query ? 'No encontramos artículos con esa búsqueda.' : 'No hay artículos en esta vista.'}</strong><span>{query ? 'La búsqueda se mantiene abierta. Corregí el texto o probá otra palabra.' : 'Probá otro filtro o agregá un artículo nuevo.'}</span>{!query ? <button className="admin-primary" onClick={() => setShowAdd(true)}>+ Agregar artículo</button> : null}</div>}
  </section>;
}

function PublicReviewFields({ product }: { product: AdminProduct }) {
  return <dl className="review-fields public-fields"><div><dt>Item ID</dt><dd>{formatItemNumber(product.itemNumber)}</dd></div><div><dt>Categoría</dt><dd>{product.category}</dd></div><div><dt>Precio pedido</dt><dd>{formatPYG(product.askingPricePYG)}</dd></div>{product.originalPricePYG ? <div><dt>Precio anterior visible</dt><dd>{formatPYG(product.originalPricePYG)}</dd></div> : null}<div className="wide"><dt>Descripción pública</dt><dd>{product.description}</dd></div><div className="wide public-exclusions"><dt>Objetos visibles no incluidos</dt><dd>{publicExclusions(product.description)}</dd></div><div><dt>Estado / condición</dt><dd>{product.condition}</dd></div><div className="wide"><dt>Funcionamiento y observaciones públicas</dt><dd>{product.conditionNotes || 'Sin observaciones adicionales'}</dd></div><div className="wide"><dt>Defectos conocidos públicos</dt><dd>{product.knownDefects || 'Ninguno informado'}</dd></div><div className="wide"><dt>Incluye</dt><dd>{product.includedAccessories.length ? product.includedAccessories.join(' · ') : 'Ningún accesorio indicado'}</dd></div><div><dt>Modalidad de venta</dt><dd>{product.saleMode === 'DELAYED' ? 'Reserva y retiro posterior' : 'Pago completo y retiro inmediato'}</dd></div><div><dt>Retiro</dt><dd>{product.saleMode === 'DELAYED' ? formatPickupWindow(product.pickupWindowStart, product.pickupWindowEnd, product.pickupAvailableDate) : 'Disponible después de confirmar el pago'}</dd></div>{product.saleMode === 'DELAYED' ? <div><dt>Seña / reserva</dt><dd>{product.depositPercent}%</dd></div> : null}<div className="wide"><dt>Logística pública</dt><dd>{publicLogistics(product).join(' · ') || 'Sin indicaciones especiales'}</dd></div><div className="wide"><dt>Etiquetas públicas</dt><dd><span className="public-tag-list">{product.tags.length ? product.tags.map((tag) => <span key={tag}>{tag}</span>) : 'Sin etiquetas'}</span></dd></div></dl>;
}

function publicExclusions(description: string): string {
  const sentences = description.split(/(?<=[.!?])\s+/).filter((sentence) => /no (?:está|están|esta|estan)?\s*incluid|no incluye|se vende(?:n)? por separado/i.test(sentence));
  return sentences.length ? sentences.join(' ') : 'No hay una exclusión explícita. Si otro artículo visible podría confundirse como incluido, aclaralo en la descripción.';
}

function publicLogistics(product: AdminProduct): string[] {
  return [
    product.requiresVehicle ? 'Traer vehículo' : '',
    product.requiresLoadingHelp ? 'Traer ayuda para cargar' : '',
    ...product.logisticsNotes,
  ].filter(Boolean);
}

function InternalProductDetails({ product }: { product: AdminProduct }) {
  const [audit, setAudit] = useState<InventoryAuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState('');

  async function loadAudit() {
    if (audit) return;
    try {
      const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}/audit`, { cache: 'no-store' });
      const data = await readJsonResponse<{ entries?: InventoryAuditEntry[]; error?: string }>(response);
      if (!response.ok) throw new Error(data.error);
      setAudit(data.entries ?? []);
    } catch (reason) {
      setAuditError(reason instanceof Error ? reason.message : 'No se pudo cargar el historial.');
    }
  }

  return <details className="internal-review-section" onToggle={(event) => { if (event.currentTarget.open) void loadAudit(); }}>
    <summary><span><span className="field-visibility internal">Solo interno</span><strong>Información interna / Admin</strong><small>Precios de referencia, investigación, preguntas e historial</small></span><span className="details-control">Mostrar / ocultar</span></summary>
    <div className="internal-review-body">
      <dl className="review-fields internal-fields"><div><dt>Estado interno</dt><dd>{statusLabel(product.status)}</dd></div><div><dt>Requiere revisión</dt><dd>{product.needsReview ? 'Sí' : 'No'}</dd></div><div><dt>Rango de mercado Paraguay</dt><dd>{formatPYG(product.marketLowPYG ?? 0)}–{formatPYG(product.marketHighPYG ?? 0)}</dd></div><div><dt>Estimación central</dt><dd>{product.marketEstimatePYG ? formatPYG(product.marketEstimatePYG) : 'Sin estimación central'}</dd></div><div><dt>Venta rápida recomendada</dt><dd>{product.recommendedFastSalePricePYG ? formatPYG(product.recommendedFastSalePricePYG) : 'Sin recomendación'}</dd></div><div><dt>Mínimo privado del vendedor</dt><dd>{product.adminPriceFloorPYG ? formatPYG(product.adminPriceFloorPYG) : 'Sin mínimo privado'}</dd></div><div><dt>Confianza de precio / IA</dt><dd>{product.pricingConfidence ?? 'Sin asignar'}</dd></div><div className="wide"><dt>Pregunta o incertidumbre pendiente</dt><dd>{product.reviewFlag || 'Ninguna pregunta abierta'}</dd></div><div className="wide"><dt>Investigación y fuentes</dt><dd>{product.pricingResearch ?? 'Sin investigación registrada'}</dd></div><div className="wide"><dt>Notas internas</dt><dd>{product.internalNotes || 'Sin notas internas'}</dd></div><div className="wide"><dt>Campos confirmados por el vendedor</dt><dd>{product.sellerConfirmedFields?.length ? product.sellerConfirmedFields.join(' · ') : 'Ninguno marcado todavía'}</dd></div><div><dt>ID de base de datos</dt><dd>{product.id}</dd></div><div><dt>Slug / referencia</dt><dd>{product.slug}</dd></div><div><dt>Lote</dt><dd>{product.batchId || 'Sin lote'}</dd></div><div><dt>Fotos cargadas / esperadas</dt><dd>{product.uploadedPhotoCount ?? 0} / {product.expectedPhotoCount ?? 0}</dd></div></dl>
      <section className="product-audit"><h4>Historial reciente de este Item</h4>{auditError ? <div className="form-error"><p>{auditError}</p><button type="button" onClick={() => { setAuditError(''); void loadAudit(); }}>Reintentar</button></div> : audit === null ? <p>Cargando historial…</p> : audit.length ? audit.map((entry) => <article key={entry.id}><strong>{formatItemNumber(entry.itemNumber)} · {entry.fieldName}</strong><span>{entry.actorRole} · {new Date(entry.createdAt).toLocaleString('es-PY')}</span><p><del>{JSON.stringify(entry.previousValue)}</del> → {JSON.stringify(entry.newValue)}</p></article>) : <p>Este Item todavía no tiene cambios registrados.</p>}</section>
    </div>
  </details>;
}

function BuyerPreview({ product, onClose }: { product: AdminProduct; onClose: () => void }) {
  const logistics = publicLogistics(product);
  return <div className="buyer-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="buyer-preview" role="dialog" aria-modal="true" aria-labelledby="buyer-preview-title"><header><div><span>VISTA PRIVADA · ASÍ LO VERÁ EL COMPRADOR</span><h3 id="buyer-preview-title">Vista previa del anuncio</h3></div><button onClick={onClose} aria-label="Cerrar vista previa">Cerrar ×</button></header><div className="buyer-preview-layout"><ProductImageGallery images={product.images} title={product.title} className="buyer-preview-gallery" /><div className="buyer-preview-copy"><div className="product-meta detail-meta"><span>{formatItemNumber(product.itemNumber)} · {product.category}</span><span className={product.saleMode === 'IMMEDIATE' ? 'status-now' : 'status-later'}>{product.saleMode === 'IMMEDIATE' ? 'DISPONIBLE AHORA' : 'RETIRO POSTERIOR'}</span></div><h2>{product.title}</h2>{product.originalPricePYG ? <del>{formatPYG(product.originalPricePYG)}</del> : null}<strong className="detail-price">{formatPYG(product.askingPricePYG)}</strong><span className="condition-pill">{product.condition}</span><p className="lead">{product.description}</p><div className="payment-breakdown"><div><span>Precio total</span><strong>{formatPYG(product.askingPricePYG)}</strong></div>{product.saleMode === 'DELAYED' ? <><div className="due"><span>Reserva ({product.depositPercent}%)</span><strong>{formatPYG(Math.round(product.askingPricePYG * product.depositPercent / 100))}</strong></div><div><span>Retiro</span><strong>{formatPickupWindow(product.pickupWindowStart, product.pickupWindowEnd, product.pickupAvailableDate)}</strong></div></> : <div><span>Retiro</span><strong>Después de confirmar el pago</strong></div>}</div></div></div><div className="buyer-preview-notes"><dl><div><dt>Item ID</dt><dd>{formatItemNumber(product.itemNumber)}</dd></div><div><dt>Estado</dt><dd>{product.condition}</dd></div><div><dt>Observaciones</dt><dd>{product.conditionNotes || 'Sin observaciones adicionales'}</dd></div><div><dt>Defectos conocidos</dt><dd>{product.knownDefects || 'Ninguno informado'}</dd></div><div><dt>Accesorios incluidos</dt><dd>{product.includedAccessories.length ? product.includedAccessories.join(' · ') : 'Ninguno indicado'}</dd></div></dl><div><strong>Para el retiro</strong><ul>{logistics.length ? logistics.map((note) => <li key={note}>{note}</li>) : <li>El comprador organiza el retiro.</li>}</ul><p>No hacemos delivery ni envíos.</p></div></div><footer><button onClick={onClose}>Volver a la revisión</button></footer></section></div>;
}

function PhotoReplacement({ product, onRefresh }: { product: AdminProduct; onRefresh: () => Promise<void> }) {
  const [replacing, setReplacing] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function replacePhoto(index: number, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setReplacing(index); setMessage(''); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}/photos/${index}`, { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage(`Foto ${index + 1} reemplazada correctamente.`);
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo reemplazar la foto.');
    } finally { setReplacing(null); }
  }

  async function addSecondaryPhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setReplacing(-1); setMessage(''); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}/photos`, { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage('Foto secundaria agregada correctamente.');
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo agregar la foto secundaria.');
    } finally { setReplacing(null); }
  }

  const replaceable = product.images.map((image, index) => ({ image, index })).filter(({ image }) => image !== '/photo-pending.svg');
  const hasManagedPhotos = replaceable.length > 0;
  const hasRealPhotos = product.images.some((image) => image !== '/photo-pending.svg');
  return <section className="photo-replacement"><div className="edit-section-title"><span className="field-visibility public">Público</span><h4>Administrar fotos</h4></div><p>{hasManagedPhotos ? 'Reemplazá una foto existente o agregá una nueva foto secundaria. La foto principal y el orden actual no cambiarán.' : hasRealPhotos ? 'Las fotos originales ya están visibles. Podés agregar fotos nuevas; las fotos que cargues desde aquí quedarán administrables individualmente.' : 'Este artículo necesita una foto real antes de publicarse.'}</p><div className="photo-replacement-grid">{replaceable.map(({ image, index }) => <article key={`${image}-${index}`}><img src={image} alt={`${itemTitle(product)}, foto ${index + 1}`} /><strong>{index === 0 ? 'Foto principal' : `Foto ${index + 1}`}</strong><label className="upload-button"><input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={replacing !== null} onChange={(event) => void replacePhoto(index, event.target.files)} />{replacing === index ? 'Subiendo…' : 'Elegir reemplazo'}</label></article>)}</div><div className="add-secondary-photo"><strong>{hasRealPhotos ? 'Agregar foto secundaria' : 'Agregar foto principal'}</strong><span>{hasRealPhotos ? 'Se colocará después de todas las fotos existentes.' : 'Reemplazará el marcador temporal y habilitará futuras fotos secundarias.'}</span><label className="upload-button"><input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={replacing !== null || product.images.length >= 12} onChange={(event) => void addSecondaryPhoto(event.target.files)} />{replacing === -1 ? 'Subiendo…' : product.images.length >= 12 ? 'Máximo de 12 fotos' : 'Elegir nueva foto'}</label></div>{message ? <p className="upload-status" role="status">{message}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</section>;
}

function CompleteProductEditor({ product, role, includePhotos = false, onRefresh, setBusy, busy }: { product: AdminProduct; role: 'OWNER' | 'REVIEWER'; includePhotos?: boolean; onRefresh: () => Promise<void>; setBusy: (value: string) => void; busy: string }) {
  const [form, setForm] = useState({
    title: product.title, category: product.category, description: product.description,
    askingPricePYG: String(product.askingPricePYG), originalPricePYG: String(product.originalPricePYG ?? ''),
    condition: product.condition, conditionNotes: product.conditionNotes, knownDefects: product.knownDefects ?? '',
    includedAccessories: product.includedAccessories.join('\n'), tags: product.tags.join('\n'),
    logisticsNotes: product.logisticsNotes.join('\n'), requiresVehicle: product.requiresVehicle,
    requiresLoadingHelp: product.requiresLoadingHelp, saleMode: product.saleMode,
    depositPercent: String(product.depositPercent), pickupAvailableDate: product.pickupAvailableDate ?? '',
    pickupWindowStart: product.pickupWindowStart ?? '', pickupWindowEnd: product.pickupWindowEnd ?? '',
    status: product.status, featured: product.featured, needsReview: product.needsReview,
    adminPriceFloorPYG: String(product.adminPriceFloorPYG ?? ''), marketEstimatePYG: String(product.marketEstimatePYG ?? ''),
    recommendedFastSalePricePYG: String(product.recommendedFastSalePricePYG ?? ''), pricingConfidence: product.pricingConfidence ?? '',
    pricingResearch: product.pricingResearch ?? '', internalNotes: product.internalNotes ?? '',
  });
  const [error, setError] = useState('');
  const busyKey = `product-${product.id}`;
  const splitLines = (value: string) => value.split('\n').map((entry) => entry.trim()).filter(Boolean);
  const numberOrNull = (value: string) => value.trim() ? Number(value) : null;

  async function save() {
    setBusy(busyKey); setError('');
    try {
      const changes: Record<string, unknown> = {
        title: form.title, category: form.category, description: form.description,
        askingPricePYG: Number(form.askingPricePYG), originalPricePYG: numberOrNull(form.originalPricePYG),
        condition: form.condition, conditionNotes: form.conditionNotes, knownDefects: form.knownDefects,
        includedAccessories: splitLines(form.includedAccessories), tags: splitLines(form.tags), logisticsNotes: splitLines(form.logisticsNotes),
        requiresVehicle: form.requiresVehicle, requiresLoadingHelp: form.requiresLoadingHelp, saleMode: form.saleMode,
        depositPercent: form.saleMode === 'DELAYED' ? Number(form.depositPercent) : 100,
        pickupAvailableDate: form.saleMode === 'DELAYED' ? form.pickupAvailableDate : null,
        pickupWindowStart: form.saleMode === 'DELAYED' ? form.pickupWindowStart : null,
        pickupWindowEnd: form.saleMode === 'DELAYED' ? form.pickupWindowEnd : null,
        internalNotes: form.internalNotes,
      };
      if (role === 'OWNER') Object.assign(changes, {
        status: form.status, featured: form.featured, needsReview: form.needsReview,
        adminPriceFloorPYG: numberOrNull(form.adminPriceFloorPYG), marketEstimatePYG: numberOrNull(form.marketEstimatePYG),
        recommendedFastSalePricePYG: numberOrNull(form.recommendedFastSalePricePYG),
        pricingConfidence: form.pricingConfidence.trim() || null, pricingResearch: form.pricingResearch.trim() || null,
      });
      const response = await fetch('/api/admin/products', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: product.id, changes }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.'); }
    finally { setBusy(''); }
  }

  return <div className="quick-edit-form complete-product-editor">
    <section className="quick-edit-public"><div className="edit-section-title"><span className="field-visibility public">Público</span><h4>{includePhotos ? 'Editar información pública y fotos' : 'Editar todos los campos públicos'}</h4></div><p className="editor-help">Esta es la ficha completa de {formatItemNumber(product.itemNumber)} · {product.title}. Los cambios se guardan en el mismo registro que usa la revisión de fotos.</p>{includePhotos ? <PhotoReplacement product={product} onRefresh={onRefresh} /> : null}<div className="edit-grid">
      <label><span>Nombre <b>Público</b></span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label><span>Categoría <b>Público</b></span><input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
      <label className="wide"><span>Descripción y exclusiones visibles <b>Público</b></span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label><span>Precio pedido (Gs.) <b>Público</b></span><input type="number" value={form.askingPricePYG} onChange={(event) => setForm({ ...form, askingPricePYG: event.target.value })} /></label>
      <label><span>Precio anterior visible (Gs.) <b>Público</b></span><input type="number" value={form.originalPricePYG} onChange={(event) => setForm({ ...form, originalPricePYG: event.target.value })} /></label>
      <label><span>Estado / condición <b>Público</b></span><input value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} /></label>
      <label className="wide"><span>Funcionamiento y observaciones <b>Público</b></span><textarea value={form.conditionNotes} onChange={(event) => setForm({ ...form, conditionNotes: event.target.value })} /></label>
      <label className="wide"><span>Defectos conocidos <b>Público</b></span><textarea value={form.knownDefects} onChange={(event) => setForm({ ...form, knownDefects: event.target.value })} /></label>
      <label className="wide"><span>Accesorios incluidos, uno por línea <b>Público</b></span><textarea value={form.includedAccessories} onChange={(event) => setForm({ ...form, includedAccessories: event.target.value })} /></label>
      <label className="wide"><span>Etiquetas, una por línea <b>Público</b></span><textarea value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></label>
      <label className="wide"><span>Notas logísticas, una por línea <b>Público</b></span><textarea value={form.logisticsNotes} onChange={(event) => setForm({ ...form, logisticsNotes: event.target.value })} /></label>
      <label className="check-field"><input type="checkbox" checked={form.requiresVehicle} onChange={(event) => setForm({ ...form, requiresVehicle: event.target.checked })} /><span>Traer vehículo <b>Público</b></span></label>
      <label className="check-field"><input type="checkbox" checked={form.requiresLoadingHelp} onChange={(event) => setForm({ ...form, requiresLoadingHelp: event.target.checked })} /><span>Traer ayuda para cargar <b>Público</b></span></label>
      <label><span>Modalidad de venta <b>Público</b></span><select value={form.saleMode} onChange={(event) => setForm({ ...form, saleMode: event.target.value as 'IMMEDIATE' | 'DELAYED' })}><option value="IMMEDIATE">Inmediato</option><option value="DELAYED">Posterior</option></select></label>
      {form.saleMode === 'DELAYED' ? <><label><span>Seña (%) <b>Público</b></span><input type="number" min="1" max="100" value={form.depositPercent} onChange={(event) => setForm({ ...form, depositPercent: event.target.value })} /></label><label><span>Fecha de referencia <b>Público</b></span><input type="date" value={form.pickupAvailableDate} onChange={(event) => setForm({ ...form, pickupAvailableDate: event.target.value })} /></label><label><span>Inicio de ventana <b>Público</b></span><input type="date" value={form.pickupWindowStart} onChange={(event) => setForm({ ...form, pickupWindowStart: event.target.value })} /></label><label><span>Fin de ventana <b>Público</b></span><input type="date" value={form.pickupWindowEnd} onChange={(event) => setForm({ ...form, pickupWindowEnd: event.target.value })} /></label></> : null}
    </div></section>
    <section className="quick-edit-internal complete-internal-edit"><div className="edit-section-title"><span className="field-visibility internal">Solo interno</span><h4>Información interna y operativa</h4></div><p className="editor-help">Estos campos corresponden únicamente a {formatItemNumber(product.itemNumber)} · {product.title}. No se mezclan con otros artículos.</p><div className="edit-grid">
      {role === 'OWNER' ? <><label><span>Estado interno <b>Admin</b></span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as InventoryStatus })}>{STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><label><span>Precio mínimo privado (Gs.) <b>Admin</b></span><input type="number" value={form.adminPriceFloorPYG} onChange={(event) => setForm({ ...form, adminPriceFloorPYG: event.target.value })} /></label><label><span>Estimación de mercado (Gs.) <b>Admin</b></span><input type="number" value={form.marketEstimatePYG} onChange={(event) => setForm({ ...form, marketEstimatePYG: event.target.value })} /></label><label><span>Precio venta rápida (Gs.) <b>Admin</b></span><input type="number" value={form.recommendedFastSalePricePYG} onChange={(event) => setForm({ ...form, recommendedFastSalePricePYG: event.target.value })} /></label><label><span>Confianza de precio / IA <b>Admin</b></span><input value={form.pricingConfidence} onChange={(event) => setForm({ ...form, pricingConfidence: event.target.value })} /></label><label className="wide"><span>Investigación y fuentes <b>Admin</b></span><textarea value={form.pricingResearch} onChange={(event) => setForm({ ...form, pricingResearch: event.target.value })} /></label><label className="check-field"><input type="checkbox" checked={form.featured} onChange={(event) => setForm({ ...form, featured: event.target.checked })} /><span>Destacar en la tienda <b>Admin</b></span></label><label className="check-field"><input type="checkbox" checked={form.needsReview} onChange={(event) => setForm({ ...form, needsReview: event.target.checked })} /><span>Requiere revisión <b>Admin</b></span></label></> : null}
      <label className="wide"><span>Notas privadas / respuesta del vendedor <b>Solo interno</b></span><textarea value={form.internalNotes} onChange={(event) => setForm({ ...form, internalNotes: event.target.value })} /></label>
    </div><VerificationDetails product={product} /></section>
    {error ? <p className="form-error wide" role="alert">{error}</p> : null}<button className="admin-primary wide" disabled={busy === busyKey} onClick={() => void save()}>{busy === busyKey ? 'Guardando…' : 'Guardar todos los cambios'}</button>
  </div>;
}

function VerificationDetails({ product }: { product: AdminProduct }) {
  return <div className="verification-details"><div className="verification-heading"><strong>Datos operativos y de verificación</strong><span>Solo lectura</span></div><p>Las cantidades se actualizan automáticamente con los pedidos. IDs, slug, lote y fechas son referencias del sistema.</p><dl className="review-fields internal-fields"><div><dt>Item ID</dt><dd>{formatItemNumber(product.itemNumber)}</dd></div><div><dt>Cantidad total</dt><dd>{product.quantityTotal ?? 0}</dd></div><div><dt>Disponible / retenida / vendida</dt><dd>{product.quantityRemaining ?? 0} / {product.quantityHeld ?? 0} / {product.quantitySold ?? 0}</dd></div><div><dt>Fotos visibles</dt><dd>{product.images.length} · {product.uploadedPhotoCount ?? 0} cargadas en almacenamiento privado</dd></div><div><dt>Slug</dt><dd>{product.slug}</dd></div><div><dt>ID de base de datos</dt><dd>{product.id}</dd></div><div><dt>Lote de origen</dt><dd>{product.batchId || 'Agregado por separado'}</dd></div><div><dt>Fecha de alta</dt><dd>{product.dateListed}</dd></div><div><dt>Último cambio de precio</dt><dd>{product.lastPriceChange || 'Sin cambios registrados'}</dd></div><div className="wide"><dt>Campos confirmados</dt><dd>{product.sellerConfirmedFields?.length ? product.sellerConfirmedFields.join(' · ') : 'Ninguno marcado todavía'}</dd></div></dl></div>;
}

function OwnerSafety({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [snapshots, setSnapshots] = useState<InventorySnapshotSummary[]>([]);
  const [entries, setEntries] = useState<InventoryAuditEntry[]>([]);
  const [orderEntries, setOrderEntries] = useState<OrderAuditEntry[]>([]);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const [backupResponse, auditResponse] = await Promise.all([fetch('/api/admin/backups', { cache: 'no-store' }), fetch('/api/admin/audit', { cache: 'no-store' })]);
    const backupData = await backupResponse.json() as { error?: string; snapshots?: InventorySnapshotSummary[] }; const auditData = await auditResponse.json() as { error?: string; entries?: InventoryAuditEntry[]; orderEntries?: OrderAuditEntry[] };
    if (!backupResponse.ok) throw new Error(backupData.error); if (!auditResponse.ok) throw new Error(auditData.error);
    setSnapshots(backupData.snapshots ?? []); setEntries(auditData.entries ?? []); setOrderEntries(auditData.orderEntries ?? []);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((reason) => setMessage(reason instanceof Error ? reason.message : 'No se pudo cargar.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function action(body: Record<string, unknown>, actionName: string) {
    setBusy(actionName); setMessage('');
    try {
      const response = await fetch('/api/admin/backups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setMessage(actionName === 'create' ? 'Snapshot verificado y guardado.' : 'Inventario restaurado desde el snapshot seleccionado.');
      setConfirmation(''); await load(); await onRefresh();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'No se pudo completar la acción.'); }
    finally { setBusy(''); }
  }

  async function revert(auditId: string) {
    setBusy(auditId); setMessage('');
    try {
      const response = await fetch('/api/admin/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'revert', auditId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setMessage('Cambio revertido y registrado en el historial.'); await load(); await onRefresh();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'No se pudo revertir.'); }
    finally { setBusy(''); }
  }

  const snapshot = snapshots.find((entry) => entry.label === 'PRE-WIFE-REVIEW — 2026-08-30');
  return <section className="admin-content owner-safety"><div className="admin-section-heading"><div><span className="section-kicker">EXCLUSIVO DEL PROPIETARIO</span><h2>Backup e historial</h2><p>Los revisores no pueden abrir, crear, restaurar ni borrar snapshots o historial.</p></div></div>
    <article className="snapshot-card"><h3>PRE-WIFE-REVIEW — 2026-08-30</h3>{snapshot ? <><p>Snapshot restorable: {snapshot.productCount} artículos reales y {snapshot.imageCount} referencias originales de imágenes.</p><p>Creado {new Date(snapshot.createdAt).toLocaleString('es-PY')} por {snapshot.createdByEmail}.</p></> : <p>Guardá el estado definitivo previo a la revisión de tu esposa.</p>}{!snapshot ? <button className="admin-primary" disabled={Boolean(busy)} onClick={() => void action({ action: 'create_pre_wife_review' }, 'create')}>{busy === 'create' ? 'Creando…' : 'Crear snapshot ahora'}</button> : null}</article>
    {snapshot ? <article className="restore-card"><h3>Restaurar este snapshot</h3><p><strong>Advertencia:</strong> se reemplazarán los cambios actuales de los 53 productos y sus referencias de imágenes por el estado guardado.</p><label>Para confirmar, escribí exactamente: <strong>{snapshot.label}</strong><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="danger" disabled={busy === 'restore' || confirmation !== snapshot.label} onClick={() => void action({ action: 'restore', snapshotId: snapshot.id, confirmation }, 'restore')}>{busy === 'restore' ? 'Restaurando…' : 'Restaurar inventario'}</button></article> : null}
    {message ? <p className="upload-status" role="status">{message}</p> : null}
    <div className="audit-history"><h3>Historial reciente de cambios</h3>{entries.length ? entries.map((entry) => <article key={entry.id}><div><strong>{formatItemNumber(entry.itemNumber)} · {entry.fieldName}</strong><span>{entry.actorRole} · {entry.actorEmail} · {new Date(entry.createdAt).toLocaleString('es-PY')}</span><p><del>{JSON.stringify(entry.previousValue)}</del> → {JSON.stringify(entry.newValue)}</p></div>{entry.fieldName !== '__snapshot_restore__' ? <button disabled={Boolean(busy)} onClick={() => void revert(entry.id)}>{busy === entry.id ? 'Revirtiendo…' : 'Revertir este campo'}</button> : null}</article>) : <p>Todavía no hay cambios registrados.</p>}</div>
    <div className="audit-history"><h3>Historial de pedidos y pagos</h3>{orderEntries.length ? orderEntries.map((entry) => <article key={entry.id}><div><strong>{entry.orderReference} · {entry.eventType}</strong><span>{entry.actorRole} · {entry.actorEmail} · {new Date(entry.createdAt).toLocaleString('es-PY')}</span><p>{JSON.stringify(entry.details)}</p></div></article>) : <p>Todavía no hay eventos de pedidos.</p>}</div>
  </section>;
}

function ReviewerAccess() {
  const [status, setStatus] = useState<ReviewerAccessStatus | null>(null);
  const [accessCode, setAccessCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/admin/reviewer-access', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setStatus(data.status ?? null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((reason) => setMessage(reason instanceof Error ? reason.message : 'No se pudo cargar.')); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function action(body: Record<string, unknown>, actionName: string) {
    setBusy(actionName); setMessage('');
    try {
      const response = await fetch('/api/admin/reviewer-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (data.accessCode) {
        setAccessCode(data.accessCode);
        setMessage('Código creado. Se muestra únicamente aquí y vence en 30 minutos.');
      } else {
        setAccessCode(null);
        setMessage(`${data.revokedCount ?? 0} sesión(es) de revisor revocada(s).`);
      }
      await load();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'No se pudo administrar el acceso.'); }
    finally { setBusy(''); }
  }

  return <section className="admin-content reviewer-access-admin"><div className="admin-section-heading"><div><span className="section-kicker">EXCLUSIVO DEL PROPIETARIO</span><h2>Acceso de revisor</h2><p>Creá un código de un solo uso para que María abra una sesión REVIEWER de 30 días sin usar ChatGPT.</p></div></div>
    <article className="reviewer-invite-card"><h3>Código seguro de un solo uso</h3><ol><li>Generá el código y compartilo únicamente con María.</li><li>María abre <strong>/admin</strong> e ingresa el código.</li><li>El código se consume al usarlo; su sesión permanece por 30 días.</li></ol><button className="admin-primary" disabled={Boolean(busy)} onClick={() => void action({ action: 'generate_code' }, 'create')}>{busy === 'create' ? 'Generando…' : 'Generar código de acceso para revisor'}</button>{accessCode ? <div className="reviewer-invite-secret"><span>Código de un solo uso</span><strong>{accessCode.code}</strong><p>Vence {new Date(accessCode.expiresAt).toLocaleString('es-PY')}. Generar otro código invalida este si todavía no fue usado.</p></div> : null}</article>
    {message ? <p className="upload-status" role="status">{message}</p> : null}
    <div className="reviewer-account-list"><h3>Sesiones de María</h3><article><div><strong>{status?.hasActiveSession ? 'Sesión REVIEWER activa' : 'No hay sesión activa'}</strong><span>{status?.hasActiveSession ? `${status.activeSessionCount} sesión(es) · la más reciente vence ${new Date(status.latestSessionExpiresAt ?? 0).toLocaleString('es-PY')}` : 'María necesitará un código para ingresar.'}</span>{status?.hasActiveCode ? <span>Código pendiente válido hasta {new Date(status.activeCodeExpiresAt ?? 0).toLocaleString('es-PY')}.</span> : null}</div><button className="danger" disabled={Boolean(busy) || !status?.hasActiveSession} onClick={() => void action({ action: 'revoke_sessions' }, 'revoke')}>{busy === 'revoke' ? 'Revocando…' : 'Revocar todas las sesiones'}</button></article><p>La revocación es inmediata. Nunca se muestran ni se almacenan aquí los tokens de sesión.</p></div>
  </section>;
}

function Overview({ snapshot, pending, setTab, onAction, busy }: { snapshot: Snapshot; pending: OrderSummary[]; setTab: (tab: Tab) => void; onAction: (id: string, action: string, details?: PaymentDetails) => void; busy: string }) {
  const stats = snapshot.stats;
  const cards = [
    ['Disponibles', stats.available, 'Artículos que todavía se pueden comprar'],
    ['Reservados', stats.reserved, 'Señas confirmadas para retiro posterior'],
    ['Vendidos', stats.sold, 'Ventas con pago completo confirmado'],
    ['Retirados', stats.pickedUp, 'Transacciones terminadas'],
    ['Pedidos a confirmar', stats.ordersAwaitingPayment ?? stats.awaitingPayment, 'Pedidos con dinero aún no confirmado'],
    ['Requieren revisión', stats.needsReview, 'Fichas que aún no deberían publicarse'],
  ];
  return <div className="admin-content">
    <section className="stats-grid">{cards.map(([label, value, detail]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong><p>{detail}</p></article>)}</section>
    <section className="money-grid"><article><span>Dinero confirmado</span><strong>{formatPYG(stats.confirmedReceived)}</strong><p>Importe realmente recibido y confirmado por David.</p></article><article><span>Saldos pendientes</span><strong>{formatPYG(stats.pendingBalances ?? stats.balancesDue)}</strong><p>Importe que todavía falta cobrar.</p></article><article><span>Valor comprometido</span><strong>{formatPYG(stats.committedSalesValue ?? 0)}</strong><p>Valor total de ventas y reservas confirmadas.</p></article><article><span>Valor disponible</span><strong>{formatPYG(stats.availableValue)}</strong><p>Precio pedido de las unidades todavía disponibles.</p></article></section>
    <div className="admin-columns">
      <section><div className="admin-section-heading"><div><span className="section-kicker">ACCIÓN PRIORITARIA</span><h2>Pagos por confirmar</h2></div><button onClick={() => setTab('orders')}>Ver todos</button></div>{pending.length ? pending.slice(0, 3).map((order) => <OrderCard key={order.id} order={order} onAction={onAction} busy={busy} />) : <div className="admin-empty">No hay pagos pendientes.</div>}</section>
      <section><div className="admin-section-heading"><div><span className="section-kicker">SEGUIMIENTO</span><h2>Estado de la venta</h2></div></div><ul className="workflow-list"><li><span>{stats.longListed}</span><div><strong>Publicados hace más de 30 días</strong><p>Conviene revisar fotos, precio o descripción.</p></div></li><li><span>{snapshot.orders.filter((order) => order.status === 'PAYMENT_CONFIRMED' && order.balanceLaterPYG > 0).length}</span><div><strong>Con saldo pendiente al retirar</strong><p>Reservas que todavía requieren un cobro final.</p></div></li><li><span>{snapshot.products.filter((product) => product.saleMode === 'DELAYED' && product.status === 'AVAILABLE').length}</span><div><strong>Con retiro posterior</strong><p>Los artículos reales usan la ventana del 9 al 12 de diciembre.</p></div></li></ul></section>
    </div>
  </div>;
}

function Orders({ orders, onAction, busy }: { orders: OrderSummary[]; onAction: (id: string, action: string, details?: PaymentDetails) => void; busy: string }) {
  const [filter, setFilter] = useState('ACTIVE');
  const filtered = orders.filter((order) => filter === 'ALL' || (filter === 'ACTIVE' ? !['CANCELLED', 'EXPIRED', 'PICKED_UP'].includes(order.status) : order.status === filter));
  return <section className="admin-content"><div className="admin-section-heading"><div><span className="section-kicker">BANDEJA DE PEDIDOS</span><h2>Reservas y ventas</h2><p>La referencia acompaña al comprador desde el checkout hasta el retiro.</p></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ACTIVE">Activos</option><option value="PAYMENT_PENDING">Pago pendiente</option><option value="PAYMENT_CONFIRMED">Pago o seña confirmado</option><option value="BALANCE_CONFIRMED">Saldo confirmado</option><option value="PICKED_UP">Retirados</option><option value="ALL">Todos</option></select></div><div className="order-list">{filtered.map((order) => <OrderCard key={order.id} order={order} onAction={onAction} busy={busy} expanded />)}{!filtered.length ? <div className="admin-empty">No hay pedidos en esta vista.</div> : null}</div></section>;
}

function OrderCard({ order, onAction, busy, expanded = false }: { order: OrderSummary; onAction: (id: string, action: string, details?: PaymentDetails) => void; busy: string; expanded?: boolean }) {
  const [paymentType, setPaymentType] = useState<'INITIAL' | 'BALANCE' | null>(null);
  const initialRemaining = Math.max(0, order.dueNowPYG - order.confirmedAmountPYG);
  const [amount, setAmount] = useState(String(initialRemaining || order.balanceLaterPYG));
  const [method, setMethod] = useState('TRANSFERENCIA');
  const pending = order.status === 'PAYMENT_PENDING';
  const confirmed = order.status === 'PAYMENT_CONFIRMED';
  const balanceConfirmed = order.status === 'BALANCE_CONFIRMED';
  const canPickUp = balanceConfirmed || (confirmed && order.balanceLaterPYG === 0);
  const canRelease = ['TEMPORARY_HOLD', 'PAYMENT_PENDING'].includes(order.status) || (confirmed && order.balanceLaterPYG > 0);
  function openPayment(nextType: 'INITIAL' | 'BALANCE') {
    setPaymentType(nextType);
    setAmount(String(nextType === 'INITIAL' ? initialRemaining : order.balanceLaterPYG));
  }
  function submitPayment() {
    if (!paymentType) return;
    onAction(order.id, paymentType === 'INITIAL' ? 'confirm_payment' : 'confirm_balance', { amountReceived: Number(amount), paymentMethod: method });
    setPaymentType(null);
  }
  return <article className={`admin-order ${expanded ? 'expanded' : ''}`}>
    <div className="order-head"><div><span className={`order-status ${order.status.toLowerCase()}`}>{order.source === 'DIRECT' ? 'Venta directa' : ORDER_STATUS_LABELS[order.status] ?? order.status.replaceAll('_', ' ')}</span><h3>{order.reference}</h3></div><strong>{formatPYG(order.totalValuePYG)}</strong></div>
    <div className="buyer-row"><div><span>Comprador</span><strong>{order.buyerName || 'Datos aún no enviados'}</strong><small>{order.buyerWhatsapp || 'Sin WhatsApp'} {order.buyerEmail ? `· ${order.buyerEmail}` : ''}</small></div><div><span>A pagar ahora</span><strong>{formatPYG(order.dueNowPYG)}</strong><small>Confirmado: {formatPYG(order.confirmedAmountPYG)}</small></div><div><span>Saldo restante</span><strong>{formatPYG(order.balanceLaterPYG)}</strong></div></div>
    <ul>{order.items.map((item) => <li key={item.id}><img src={item.image} alt="" /><span><strong>{item.itemNumber == null ? item.title : `${formatItemNumber(item.itemNumber)} · ${item.title}`}</strong><small>{item.saleMode === 'DELAYED' ? `Reserva ${item.depositPercent}% · ${formatPickupWindow(item.pickupWindowStart, item.pickupWindowEnd, item.pickupAvailableDate)}` : 'Pago completo'} · {ORDER_STATUS_LABELS[item.itemStatus] ?? item.itemStatus}</small></span><b>{formatPYG(item.dueNowPYG)}</b></li>)}</ul>
    {paymentType ? <div className="payment-entry"><strong>{paymentType === 'INITIAL' ? 'Confirmar pago recibido' : 'Confirmar saldo recibido'}</strong><label>Importe realmente recibido<input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Medio de pago<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="TRANSFERENCIA">Transferencia</option><option value="EFECTIVO">Efectivo</option><option value="OTRO">Otro</option></select></label><p>El comprobante solo sirve como referencia. Esta acción registra el dinero que David verificó.</p><div className="order-actions"><button className="confirm" disabled={Boolean(busy)} onClick={submitPayment}>{busy ? 'Guardando…' : 'Guardar confirmación'}</button><button type="button" onClick={() => setPaymentType(null)}>Cancelar</button></div></div> : null}
    <div className="order-actions">{pending ? <button className="confirm" disabled={Boolean(busy)} onClick={() => openPayment('INITIAL')}>Confirmar pago</button> : null}{order.status === 'TEMPORARY_HOLD' ? <button disabled={Boolean(busy)} onClick={() => onAction(order.id, 'mark_payment_pending')}>Marcar pago pendiente</button> : null}{confirmed && order.balanceLaterPYG > 0 ? <button className="confirm" disabled={Boolean(busy)} onClick={() => openPayment('BALANCE')}>Confirmar saldo</button> : null}{canPickUp ? <button className="confirm" disabled={Boolean(busy)} onClick={() => onAction(order.id, 'picked_up')}>Marcar como retirado</button> : null}{canRelease ? <button className="danger" disabled={Boolean(busy)} onClick={() => onAction(order.id, 'release')}>{confirmed ? 'Cancelar reserva y liberar' : 'Cancelar y liberar'}</button> : null}</div>
  </article>;
}

function DirectSale({ products, onDone }: { products: AdminProduct[]; onDone: () => Promise<void> }) {
  const available = products.filter((product) => (product.quantityRemaining ?? 0) - (product.quantityHeld ?? 0) > 0 && !['SOLD', 'RESERVED', 'PICKED_UP', 'PAYMENT_PENDING', 'TEMPORARY_HOLD'].includes(product.status));
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [buyerName, setBuyerName] = useState('');
  const [buyerWhatsapp, setBuyerWhatsapp] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('TRANSFERENCIA');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selectedProducts = available.filter((product) => selected[product.id]);
  const totals = selectedProducts.reduce((sum, product) => {
    const quantity = selected[product.id] ?? 1;
    const due = dueNowForProduct(product);
    sum.total += product.askingPricePYG * quantity;
    sum.due += due * quantity;
    sum.balance += (product.askingPricePYG - due) * quantity;
    return sum;
  }, { total: 0, due: 0, balance: 0 });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/direct-sales', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: selectedProducts.map((product) => ({ productId: product.id, quantity: selected[product.id] ?? 1 })), buyerName, buyerWhatsapp, amountReceived: Number(amount), paymentMethod: method }),
      });
      const data = await response.json() as { error?: string; order?: OrderSummary };
      if (!response.ok) throw new Error(data.error);
      setSelected({}); setBuyerName(''); setBuyerWhatsapp(''); setAmount('');
      setMessage(`Venta ${data.order?.reference ?? 'directa'} registrada. Se actualizó el inventario.`);
      await onDone();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo registrar la venta directa.'); }
    finally { setBusy(false); }
  }

  return <section className="admin-content direct-sale"><div className="admin-section-heading"><div><span className="section-kicker">SOLO VENTAS FUERA DEL SITIO</span><h2>Registrar venta directa</h2><p>Usá esta sección únicamente si la venta comenzó completamente fuera de la web. Los pedidos del carrito se confirman desde Pedidos.</p></div></div><form className="add-product" onSubmit={submit}><h3>Artículos vendidos fuera del sitio</h3><div className="direct-sale-products">{available.map((product) => { const availableQuantity = Math.max(0, (product.quantityRemaining ?? 0) - (product.quantityHeld ?? 0)); const checked = Boolean(selected[product.id]); return <label className="direct-sale-product" key={product.id}><input type="checkbox" checked={checked} onChange={(event) => setSelected({ ...selected, [product.id]: event.target.checked ? 1 : 0 })} /><span><strong>{formatItemNumber(product.itemNumber)} · {product.title}</strong><small>{formatPYG(product.askingPricePYG)} · {availableQuantity} disponible(s) · {product.saleMode === 'DELAYED' ? `Seña ${product.depositPercent}%` : 'Pago completo'}</small></span>{checked && availableQuantity > 1 ? <input aria-label={`Cantidad de ${product.title}`} type="number" min="1" max={availableQuantity} value={selected[product.id]} onChange={(event) => setSelected({ ...selected, [product.id]: Math.min(availableQuantity, Math.max(1, Number(event.target.value) || 1)) })} /> : null}</label>; })}{!available.length ? <p>No hay unidades disponibles para registrar.</p> : null}</div><div className="editor-grid"><label>Comprador <span>(opcional)</span><input value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></label><label>WhatsApp <span>(opcional)</span><input value={buyerWhatsapp} onChange={(event) => setBuyerWhatsapp(event.target.value)} /></label><label>Importe recibido<input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={totals.due ? String(totals.due) : 'Seleccioná artículos'} /></label><label>Medio de pago<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="TRANSFERENCIA">Transferencia</option><option value="EFECTIVO">Efectivo</option><option value="OTRO">Otro</option></select></label></div>{selectedProducts.length ? <p className="direct-sale-total">Total: {formatPYG(totals.total)} · A pagar ahora: {formatPYG(totals.due)} · Saldo: {formatPYG(totals.balance)}</p> : null}<p>Esta acción crea un solo registro de venta directa y bloquea las unidades seleccionadas. No la uses para un pedido del carrito.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="upload-status" role="status">{message}</p> : null}<button className="admin-primary" disabled={busy || !selectedProducts.length}>{busy ? 'Registrando…' : 'Registrar venta directa'}</button></form></section>;
}

function Inventory({ products, onRefresh, setBusy, busy }: { products: AdminProduct[]; onRefresh: () => Promise<void>; setBusy: (value: string) => void; busy: string }) {
  const [filter, setFilter] = useState('ALL');
  const [showAdd, setShowAdd] = useState(false);
  const visible = products.filter((product) => filter === 'ALL' || product.status === filter || (filter === 'REVIEW' && product.needsReview));
  return <section className="admin-content"><div className="admin-section-heading"><div><span className="section-kicker">INVENTARIO</span><h2>Artículos</h2><p>Los campos privados aparecen solo en este panel.</p></div><div className="heading-actions"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">Todos</option><option value="AVAILABLE">Disponibles</option><option value="PAYMENT_PENDING">Pago pendiente</option><option value="RESERVED">Reservados</option><option value="SOLD">Vendidos</option><option value="PICKED_UP">Retirados</option><option value="REVIEW">Requieren revisión</option><option value="UNLISTED">No publicados</option></select><button className="admin-primary" onClick={() => setShowAdd(!showAdd)}>+ Agregar artículo</button></div></div>{showAdd ? <AddProduct onDone={async () => { setShowAdd(false); await onRefresh(); }} /> : null}<div className="inventory-list">{visible.map((product) => <ProductEditor key={product.id} product={product} onRefresh={onRefresh} setBusy={setBusy} busy={busy} />)}</div></section>;
}

function ProductEditor({ product, onRefresh, setBusy, busy }: { product: AdminProduct; onRefresh: () => Promise<void>; setBusy: (value: string) => void; busy: string }) {
  return <details className="inventory-item"><summary><img src={product.images[0]} alt="" /><div><span className={`order-status ${product.status.toLowerCase()}`}>{statusLabel(product.status)}</span><h3>{product.title}</h3><p>{formatItemNumber(product.itemNumber)} · {product.category} · {formatPYG(product.askingPricePYG)} · {product.saleMode === 'DELAYED' ? `Retiro ${formatPickupDate(product.pickupAvailableDate)}` : 'Retiro inmediato'}</p></div><b>{product.needsReview ? 'Revisar ficha completa' : 'Editar ficha completa'}</b></summary><div className="product-editor"><CompleteProductEditor product={product} role="OWNER" onRefresh={onRefresh} setBusy={setBusy} busy={busy} /></div></details>;
}

function AddProduct({ onDone }: { onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ title: '', category: 'Varios', description: '', condition: 'A revisar', askingPricePYG: '', saleMode: 'IMMEDIATE', pickupAvailableDate: '2026-12-07', depositPercent: '25', internalNotes: 'DEMO DATA' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { const response = await fetch('/api/admin/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, askingPricePYG: Number(form.askingPricePYG), depositPercent: Number(form.depositPercent), status: 'NEEDS_REVIEW' }) }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error); await onDone(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo agregar.'); } finally { setBusy(false); } }
  return <form className="add-product" onSubmit={submit}><h3>Nuevo artículo de muestra</h3><div className="editor-grid"><label>Nombre<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Categoría<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label><label>Precio (Gs.)<input required type="number" value={form.askingPricePYG} onChange={(event) => setForm({ ...form, askingPricePYG: event.target.value })} /></label><label>Estado del artículo<input value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} /></label><label>Modo de venta<select value={form.saleMode} onChange={(event) => setForm({ ...form, saleMode: event.target.value })}><option value="IMMEDIATE">Disponible ahora</option><option value="DELAYED">Retiro posterior</option></select></label><label>Fecha de retiro<input type="date" value={form.pickupAvailableDate} onChange={(event) => setForm({ ...form, pickupAvailableDate: event.target.value })} /></label></div><label>Descripción<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>{error ? <p className="form-error">{error}</p> : null}<button className="admin-primary" disabled={busy}>{busy ? 'Agregando…' : 'Crear como “Requiere revisión”'}</button></form>;
}

function Pricing({ products }: { products: AdminProduct[] }) {
  const candidates = useMemo(() => products.filter((product) => product.status === 'AVAILABLE').sort((a, b) => a.dateListed.localeCompare(b.dateListed)), [products]);
  return <section className="admin-content"><div className="pricing-intro"><span className="section-kicker">PLAN DE REDUCCIONES</span><h2>Sugerencias, nunca cambios automáticos</h2><p>La herramienta puede comparar precio de mercado, precio pedido y mínimo privado. Cualquier reducción requiere aprobación del vendedor.</p></div><div className="timeline"><div><strong>Agosto–septiembre</strong><span>Precio normal</span></div><div><strong>Octubre</strong><span>Revisar ventas lentas</span></div><div><strong>Noviembre</strong><span>Reducciones más firmes</span></div><div><strong>Fin de noviembre–diciembre</strong><span>Liquidación final</span></div></div><div className="pricing-table"><div className="pricing-row header"><span>Artículo</span><span>Mercado</span><span>Precio actual</span><span>Venta rápida</span><span>Mínimo privado</span></div>{candidates.map((product) => <div className="pricing-row" key={product.id}><span><strong>{product.title}</strong><small>{product.pricingConfidence || 'Sin confianza'} · {product.dateListed}</small></span><span>{product.marketEstimatePYG ? formatPYG(product.marketEstimatePYG) : 'Pendiente'}</span><span>{formatPYG(product.askingPricePYG)}</span><span>{product.recommendedFastSalePricePYG ? formatPYG(product.recommendedFastSalePricePYG) : 'Pendiente'}</span><span className="private-value">{product.adminPriceFloorPYG ? formatPYG(product.adminPriceFloorPYG) : 'Pendiente'}<small>Privado</small></span></div>)}</div></section>;
}
