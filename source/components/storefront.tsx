'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PublicProduct } from '@/lib/types';
import { formatItemNumber } from '@/lib/types';
import { ProductCard } from './product-card';
import { PUBLIC_CONFIG, whatsappHref } from '@/lib/config';

type Availability = 'ALL' | 'IMMEDIATE' | 'DELAYED' | 'REDUCED';
const FILTER_KEY = 'mudanza-catalog-filters';
const SCROLL_KEY = 'mudanza-catalog-scroll';

export function Storefront({ products }: { products: PublicProduct[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todas');
  const [availability, setAvailability] = useState<Availability>('ALL');
  const [condition, setCondition] = useState('Todas');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('recommended');
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(FILTER_KEY);
      if (saved) {
        const value = JSON.parse(saved) as Partial<{ query: string; category: string; availability: Availability; condition: string; maxPrice: string; sort: string }>;
        if (typeof value.query === 'string') setQuery(value.query);
        if (typeof value.category === 'string') setCategory(value.category);
        if (value.availability) setAvailability(value.availability);
        if (typeof value.condition === 'string') setCondition(value.condition);
        if (typeof value.maxPrice === 'string') setMaxPrice(value.maxPrice);
        if (typeof value.sort === 'string') setSort(value.sort);
      }
    } catch {
      window.sessionStorage.removeItem(FILTER_KEY);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    window.sessionStorage.setItem(FILTER_KEY, JSON.stringify({ query, category, availability, condition, maxPrice, sort }));
  }, [restored, query, category, availability, condition, maxPrice, sort]);

  useEffect(() => {
    if (!restored) return;
    const savedScroll = Number(window.sessionStorage.getItem(SCROLL_KEY));
    if (Number.isFinite(savedScroll) && savedScroll > 0) {
      window.sessionStorage.removeItem(SCROLL_KEY);
      window.requestAnimationFrame(() => window.scrollTo({ top: savedScroll }));
    }
  }, [restored]);

  function resetFilters() {
    setQuery('');
    setCategory('Todas');
    setAvailability('ALL');
    setCondition('Todas');
    setMaxPrice('');
    setSort('recommended');
  }

  const categories = ['Todas', ...new Set(products.map((product) => product.category))];
  const conditions = ['Todas', ...new Set(products.map((product) => product.condition))];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = products.filter((product) => {
      const haystack = `${formatItemNumber(product.itemNumber)} ${product.title} ${product.category} ${product.tags.join(' ')}`.toLowerCase();
      if (normalized && !haystack.includes(normalized)) return false;
      if (category !== 'Todas' && product.category !== category) return false;
      if (condition !== 'Todas' && product.condition !== condition) return false;
      if (availability === 'IMMEDIATE' && product.saleMode !== 'IMMEDIATE') return false;
      if (availability === 'DELAYED' && product.saleMode !== 'DELAYED') return false;
      if (availability === 'REDUCED' && !(product.originalPricePYG && product.originalPricePYG > product.askingPricePYG)) return false;
      if (maxPrice && product.askingPricePYG > Number(maxPrice)) return false;
      return true;
    });
    return result.sort((a, b) => {
      if (sort === 'price-asc') return a.askingPricePYG - b.askingPricePYG;
      if (sort === 'price-desc') return b.askingPricePYG - a.askingPricePYG;
      if (sort === 'newest') return b.dateListed.localeCompare(a.dateListed);
      if (sort === 'reduced') return (b.lastPriceChange ?? '').localeCompare(a.lastPriceChange ?? '');
      return Number(b.featured) - Number(a.featured);
    });
  }, [products, query, category, availability, condition, maxPrice, sort]);

  const featured = products.filter((product) => product.featured).slice(0, 4);
  const immediate = products.filter((product) => product.saleMode === 'IMMEDIATE' && product.status === 'AVAILABLE').slice(0, 4);
  const delayed = products.filter((product) => product.saleMode === 'DELAYED' && product.status === 'AVAILABLE').slice(0, 4);

  return (
    <main>
      <section className="intro" id="inicio">
        <div className="eyebrow"><span /> VENTA DE MUDANZA · INVENTARIO REAL</div>
        <div className="intro-grid">
          <div>
            <h1>Una casa llena de cosas buenas, listas para una nueva vida.</h1>
            <p>En diciembre de 2026 volvemos a Estados Unidos. Vendemos muebles, electrodomésticos y objetos del hogar que no podemos llevar con nosotros.</p>
          </div>
          <aside>
            <strong>Todo es retiro personal</strong>
            <p><b>Disponible ahora:</b> pagás el total por transferencia para confirmar.</p>
            <p><b>Retiro posterior:</b> reservás con una seña y retirás desde la fecha indicada.</p>
          </aside>
        </div>
      </section>

      <section className="catalog" id="articulos" aria-labelledby="catalog-title">
        <div className="catalog-heading">
          <div><span className="section-kicker">CATÁLOGO</span><h2 id="catalog-title">Encontrá algo para tu casa</h2></div>
          <p>{filtered.length} {filtered.length === 1 ? 'artículo' : 'artículos'} · Retiro en {PUBLIC_CONFIG.pickupArea}</p>
        </div>

        <div className="search-panel">
          <label className="search-field wide"><span aria-hidden="true">⌕</span><span className="sr-only">Buscar artículos</span><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Buscar heladera, mesa, herramientas…" /></label>
          <label><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Disponibilidad</span><select value={availability} onChange={(event) => setAvailability(event.target.value as Availability)}><option value="ALL">Todas</option><option value="IMMEDIATE">Disponible ahora</option><option value="DELAYED">Retiro posterior</option><option value="REDUCED">Rebajados</option></select></label>
          <label><span>Estado</span><select value={condition} onChange={(event) => setCondition(event.target.value)}>{conditions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Precio máximo</span><select value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)}><option value="">Sin límite</option><option value="500000">Gs. 500.000</option><option value="1000000">Gs. 1.000.000</option><option value="2000000">Gs. 2.000.000</option><option value="3000000">Gs. 3.000.000</option></select></label>
          <label><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recommended">Recomendados</option><option value="price-asc">Precio menor a mayor</option><option value="price-desc">Precio mayor a menor</option><option value="newest">Más recientes</option><option value="reduced">Rebajados recientemente</option></select></label>
        </div>

        <div className="category-row" aria-label="Categorías populares">
          {categories.slice(0, 8).map((item) => <button className={category === item ? 'active' : ''} type="button" key={item} onClick={() => setCategory(item)}>{item}</button>)}
          <button className="reset-filters" type="button" onClick={resetFilters}>Restablecer filtros</button>
        </div>

        {filtered.length ? <div className="product-grid">{filtered.map((product) => <ProductCard product={product} key={product.id} />)}</div> : <div className="empty-state"><strong>No encontramos artículos con esos filtros.</strong><button type="button" onClick={resetFilters}>Limpiar filtros</button></div>}
      </section>

      <Shelf title="Selección destacada" kicker="PARA EMPEZAR" products={featured} />
      <Shelf title="Disponibles para retirar ahora" kicker="PAGO COMPLETO" products={immediate} />
      <Shelf title="Reservá hoy, retirá en la fecha indicada" kicker="SEÑA CONFIGURABLE" products={delayed} warm />

      <section className="how-it-works" aria-labelledby="how-title">
        <div><span className="section-kicker">COMPRA CLARA, SIN SORPRESAS</span><h2 id="how-title">Así funciona</h2><p>Un mensaje de interés no reserva el artículo. La reserva se confirma cuando verificamos el pago o la seña correspondiente.</p></div>
        <ol><li><span>01</span><strong>Elegí</strong><p>Revisá estado, precio y fecha de retiro.</p></li><li><span>02</span><strong>Transferí</strong><p>Te mostramos exactamente cuánto pagar ahora.</p></li><li><span>03</span><strong>Esperá la confirmación</strong><p>Verificamos la transferencia manualmente.</p></li><li><span>04</span><strong>Retirá</strong><p>Compartimos la dirección exacta en privado.</p></li></ol>
      </section>

      <section className="faq" id="preguntas" aria-labelledby="faq-title">
        <div className="faq-intro"><span className="section-kicker">PREGUNTAS FRECUENTES</span><h2 id="faq-title">Antes de comprar</h2><a href={whatsappHref('Hola, tengo una consulta sobre la venta de mudanza.')} target="_blank" rel="noreferrer">Hacer otra consulta por WhatsApp</a></div>
        <div className="faq-list">
          <details><summary>¿Hacen delivery?</summary><p>No. Todos los artículos se retiran personalmente. El comprador es responsable del transporte.</p></details>
          <details><summary>¿Dónde se retiran los artículos?</summary><p>En {PUBLIC_CONFIG.pickupArea}. La dirección exacta se comparte en privado después de confirmar el pago o la reserva.</p></details>
          <details><summary>¿Puedo reservar algo?</summary><p>Sí, cuando el artículo indica retiro posterior. La reserva se confirma con la seña indicada, normalmente del 25%.</p></details>
          <details><summary>¿Por qué algunos artículos tienen retiro posterior?</summary><p>Porque seguimos usando ciertos objetos del hogar hasta poco antes de la mudanza. Los artículos reales indican su ventana exacta de retiro.</p></details>
          <details><summary>¿Puedo reservar sin pagar?</summary><p>No. Una consulta o un “guardame” no garantiza el artículo. La reserva queda firme después de verificar el pago aplicable.</p></details>
          <details><summary>¿Cómo pago?</summary><p>Por transferencia bancaria paraguaya. Los datos se muestran únicamente durante el checkout.</p></details>
          <details><summary>¿Puedo hacer una oferta?</summary><p>Podés escribirnos por WhatsApp para consultar. Cada propuesta se evalúa de forma particular.</p></details>
        </div>
      </section>

      <a className="floating-whatsapp" href={whatsappHref('Hola, quisiera consultar sobre la venta de mudanza.')} target="_blank" rel="noreferrer">WhatsApp</a>
    </main>
  );
}

function Shelf({ title, kicker, products, warm = false }: { title: string; kicker: string; products: PublicProduct[]; warm?: boolean }) {
  if (!products.length) return null;
  return <section className={`shelf ${warm ? 'warm' : ''}`}><div className="shelf-heading"><span className="section-kicker">{kicker}</span><h2>{title}</h2></div><div className="shelf-grid">{products.map((product) => <ProductCard compact product={product} key={`${title}-${product.id}`} />)}</div></section>;
}
