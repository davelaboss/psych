'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicProduct } from '@/lib/types';
import { formatItemNumber } from '@/lib/types';
import { ProductCard } from './product-card';
import { PUBLIC_CONFIG, whatsappHref } from '@/lib/config';

type Availability = 'ALL' | 'IMMEDIATE' | 'DELAYED';
const FILTER_KEY = 'mudanza-catalog-filters';
const SCROLL_KEY = 'mudanza-catalog-scroll';
const INITIAL_RENDER_COUNT = 48;
const CORE_CATEGORIES = ['Cocina', 'Hogar', 'Oficina', 'Electrodomésticos', 'Jardín', 'Muebles', 'Herramientas'];

export function Storefront({ products }: { products: PublicProduct[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todas');
  const [availability, setAvailability] = useState<Availability>('ALL');
  const [condition, setCondition] = useState('Todas');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('catalog');
  const [showSold, setShowSold] = useState(false);
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const [restored, setRestored] = useState(false);
  const loadSentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(FILTER_KEY);
      if (saved) {
        const value = JSON.parse(saved) as Partial<{ query: string; category: string; availability: Availability; condition: string; maxPrice: string; sort: string; showSold: boolean }>;
        if (typeof value.query === 'string') setQuery(value.query);
        if (typeof value.category === 'string') setCategory(value.category);
        if (value.availability) setAvailability(value.availability);
        if (typeof value.condition === 'string') setCondition(value.condition);
        if (typeof value.maxPrice === 'string') setMaxPrice(value.maxPrice);
        if (typeof value.sort === 'string') setSort(value.sort);
        if (typeof value.showSold === 'boolean') setShowSold(value.showSold);
      }
    } catch {
      window.sessionStorage.removeItem(FILTER_KEY);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    window.sessionStorage.setItem(FILTER_KEY, JSON.stringify({ query, category, availability, condition, maxPrice, sort, showSold }));
  }, [restored, query, category, availability, condition, maxPrice, sort, showSold]);

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
    setSort('catalog');
    setShowSold(false);
  }

  const categories = ['Todas', ...new Set(products.map((product) => product.category).filter(Boolean))];
  const coreCategories = ['Todas', ...CORE_CATEGORIES.filter((item) => categories.includes(item))];
  const moreCategories = categories.filter((item) => !coreCategories.includes(item));
  const conditions = ['Todas', ...new Set(products.map((product) => product.condition))];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = products.filter((product) => {
      if (!showSold && product.status !== 'AVAILABLE') return false;
      const haystack = `${formatItemNumber(product.itemNumber)} ${product.itemNumber} ${product.title} ${product.category} ${product.description} ${product.tags.join(' ')}`.toLowerCase();
      if (normalized && !haystack.includes(normalized)) return false;
      if (category !== 'Todas' && product.category !== category) return false;
      if (condition !== 'Todas' && product.condition !== condition) return false;
      if (availability === 'IMMEDIATE' && product.saleMode !== 'IMMEDIATE') return false;
      if (availability === 'DELAYED' && product.saleMode !== 'DELAYED') return false;
      if (maxPrice && product.askingPricePYG > Number(maxPrice)) return false;
      return true;
    });
    return result.sort((a, b) => {
      const availableFirst = Number(a.status !== 'AVAILABLE') - Number(b.status !== 'AVAILABLE');
      if (availableFirst) return availableFirst;
      if (sort === 'price-asc') return a.askingPricePYG - b.askingPricePYG || Number(a.itemNumber) - Number(b.itemNumber);
      if (sort === 'price-desc') return b.askingPricePYG - a.askingPricePYG || Number(a.itemNumber) - Number(b.itemNumber);
      if (sort === 'newest') return b.dateListed.localeCompare(a.dateListed) || Number(b.itemNumber) - Number(a.itemNumber);
      return Number(a.itemNumber) - Number(b.itemNumber);
    });
  }, [products, query, category, availability, condition, maxPrice, sort, showSold]);

  useEffect(() => setVisibleCount(INITIAL_RENDER_COUNT), [query, category, availability, condition, maxPrice, sort, showSold]);

  useEffect(() => {
    const sentinel = loadSentinel.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((count) => Math.min(count + INITIAL_RENDER_COUNT, filtered.length));
      }
    }, { rootMargin: '900px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filtered.length]);

  const advancedFilterCount = Number(condition !== 'Todas') + Number(Boolean(maxPrice)) + Number(sort !== 'catalog') + Number(showSold);
  const hasFilters = Boolean(query || category !== 'Todas' || availability !== 'ALL' || advancedFilterCount);

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
          <label className="catalog-search-label" htmlFor="catalog-search"><span>¿Qué estás buscando?</span><input id="catalog-search" value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Ej.: mesa, licuadora o Item 125" autoComplete="off" /><small>Podés buscar por palabra o número de Item.</small></label>
        </div>

        <div className="catalog-discovery">
          <p className="category-prompt">O elegí una categoría</p>
          <div className="category-row" aria-label="Categorías principales">
            {coreCategories.map((item) => <button className={category === item ? 'active' : ''} type="button" key={item} onClick={() => setCategory(item)}>{item}</button>)}
            <button className="more-categories-toggle" type="button" aria-expanded={showMoreCategories} onClick={() => setShowMoreCategories((open) => !open)}>Más categorías</button>
          </div>
          {showMoreCategories && <div className="more-categories-panel"><p>Todas las categorías</p><div className="category-row category-row-more">{moreCategories.map((item) => <button className={category === item ? 'active' : ''} type="button" key={item} onClick={() => setCategory(item)}>{item}</button>)}</div></div>}

          <fieldset className="availability-choices"><legend>¿Cuándo lo necesitás?</legend><div className="availability-row">{([['ALL', 'Todos'], ['IMMEDIATE', 'Disponible ahora'], ['DELAYED', 'Retiro posterior']] as const).map(([value, label]) => <button className={availability === value ? 'active' : ''} type="button" aria-pressed={availability === value} key={value} onClick={() => setAvailability(value)}>{label}</button>)}</div></fieldset>

          <div className="catalog-toolbar">
            <strong aria-live="polite">{filtered.length} {filtered.length === 1 ? 'artículo' : 'artículos'} {showSold ? 'en el catálogo · incluye vendidos' : filtered.length === 1 ? 'disponible' : 'disponibles'}</strong>
            <details className="more-filters"><summary>Más filtros {advancedFilterCount > 0 && <span>{advancedFilterCount}</span>}</summary><div className="advanced-filter-grid">
              <label><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label><span>Estado</span><select value={condition} onChange={(event) => setCondition(event.target.value)}>{conditions.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label><span>Precio máximo</span><select value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)}><option value="">Sin límite</option><option value="500000">Gs. 500.000</option><option value="1000000">Gs. 1.000.000</option><option value="2000000">Gs. 2.000.000</option><option value="3000000">Gs. 3.000.000</option></select></label>
              <label><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="catalog">Orden del catálogo</option><option value="newest">Más recientes</option><option value="price-asc">Precio menor a mayor</option><option value="price-desc">Precio mayor a menor</option></select></label>
              <label className="show-sold-option"><input type="checkbox" checked={showSold} onChange={(event) => setShowSold(event.target.checked)} /><span>Ver artículos vendidos</span></label>
              {hasFilters && <button className="reset-filters" type="button" onClick={resetFilters}>Restablecer filtros</button>}
            </div></details>
          </div>
        </div>

        {filtered.length ? <><div className="product-grid">{filtered.slice(0, visibleCount).map((product) => <ProductCard product={product} key={product.id} />)}</div><div className="catalog-load-controls"><button hidden={visibleCount >= filtered.length} type="button" onClick={() => setVisibleCount((count) => Math.min(count + INITIAL_RENDER_COUNT, filtered.length))}>Cargar más artículos ({Math.max(0, filtered.length - visibleCount)} restantes)</button><div ref={loadSentinel} aria-hidden="true" /></div></> : <div className="empty-state"><strong>No encontramos artículos con esos filtros.</strong><button type="button" onClick={resetFilters}>Limpiar filtros</button></div>}
      </section>

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
