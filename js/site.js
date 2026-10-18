// File: js/site.js

const STATIC_CART_KEY = 'mudanza-demo-cart';
const CART_WARNING_DEADLINES_KEY = 'mudanza-cart-warning-deadlines';
const CART_EXPIRATION_EVENTS_KEY = 'mudanza-cart-expiration-events';
const RESERVATION_TIME_ZONE = 'America/Asuncion';
const DELAYED_FINAL_PAYMENT_WINDOW = '1–8 diciembre 2026';
const FINAL_SALE_POLICY_VERSION = '2026-10-02-v1';
const FINAL_SALE_SHORT_NOTICE = 'Importante: La mayoría de los artículos son usados. Todas las ventas son finales.';
const NO_DELIVERY_NOTICE = 'No realizamos entregas. El comprador debe retirar su compra en nuestro domicilio en la fecha correspondiente.';
const DELAYED_PICKUP_NOTICE = 'Aunque el artículo esté pagado, si está marcado para retiro posterior deberá permanecer con nosotros hasta la fecha de retiro indicada.';
window.loadAuthoritativeCatalog = loadAuthoritativeCatalog;
window.__staticCartReady = syncStaticCartFromServer({ migrateLegacy: true });

function loadAuthoritativeCatalog(requestedSlug = '') {
  if (!window.__catalogReady) {
    const url = new URL('/.netlify/functions/volume2-catalog', window.location.origin);
    if (requestedSlug) url.searchParams.set('slug', requestedSlug);

    window.__catalogReady = fetch(url, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'No se pudo cargar el catálogo.');
        }

        if (!Array.isArray(data.products)) {
          throw new Error('El catálogo no tiene el formato esperado.');
        }

        const catalog = {
          products: data.products,
          deliveredProduct: data.deliveredProduct && typeof data.deliveredProduct === 'object'
            ? data.deliveredProduct
            : null,
        };

        window.__catalogProducts = catalog.products;
        return catalog;
      });
  }

  return window.__catalogReady;
}

async function bootStaticStorefront() {
  setupStaticMobileNavigation();

  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (path.startsWith('/producto/')) {
    const slug = decodeURIComponent(path.slice('/producto/'.length));
    const product = getEmbeddedProductBySlug(slug);

    if (!product) {
      // The unified catalog controller owns authoritative route resolution.
      // Keep the homepage hidden until it renders the product or unavailable view.
      return;
    }

    renderProductDetail(product);
    await window.__staticCartReady;
    updateStaticCartCount();
    return;
  }

  await window.__staticCartReady;
  updateStaticCartCount();
  refreshCartReservationUi();

  if (path === '/carrito') {
    await renderSynchronizedCartPage();
    return;
  }

  if (path === '/' || path === '/index.html') {
    setupCatalogCartButtons();
  }
}

async function renderSynchronizedCartPage() {
  if (!window.__staticCartSynchronized) {
    renderCartLoadError(
      'No pudimos confirmar tu carrito.',
      'Intentá nuevamente en unos minutos.'
    );
    return;
  }

  const cart = getStaticCart();

  if (cart.ids.length) {
    try {
      await loadAuthoritativeCatalog();
    } catch (error) {
      console.error('Carrito:', error);
      renderCartLoadError(
        'No se pudo cargar tu carrito.',
        'No mostramos un estado incompleto. Intentá nuevamente en unos minutos.'
      );
      return;
    }
  }

  renderCartPage();
}

function renderCartLoadError(title, message) {
  const main = document.querySelector('main');
  if (!main) return;

  document.title = 'Carrito | Venta de Mudanza';
  main.innerHTML = `
    <section class="empty-cart" role="alert">
      <span>Tu carrito</span>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a class="primary-action" href="/carrito">Volver a intentar</a>
    </section>
  `;
  completeCartRoute();
}

function completeCartRoute() {
  document.documentElement.classList.remove('cart-route-pending');
  window.dispatchEvent(new CustomEvent('storefront:cart-rendered'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootStaticStorefront, { once: true });
} else {
  bootStaticStorefront();
}


function setupStaticMobileNavigation() {
  const nav = document.querySelector('.site-header nav');

  if (!nav || nav.querySelector('.menu-toggle')) {
    return;
  }

  nav.classList.add('site-nav');

  const cartLink = nav.querySelector('.cart-link');
  const menuLinks = Array.from(
    nav.querySelectorAll(':scope > a:not(.cart-link)')
  );

  if (!cartLink || !menuLinks.length) {
    return;
  }

  const menuToggle = document.createElement('button');
  menuToggle.className = 'menu-toggle';
  menuToggle.type = 'button';
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-controls', 'primary-navigation-links');
  menuToggle.setAttribute('aria-label', 'Abrir menú');
  menuToggle.innerHTML = '<span aria-hidden="true">☰</span>';

  const menuContainer = document.createElement('div');
  menuContainer.className = 'mobile-nav-links';
  menuContainer.id = 'primary-navigation-links';

  menuLinks.forEach((link) => {
    menuContainer.appendChild(link);
  });

  nav.insertBefore(menuToggle, cartLink);
  nav.insertBefore(menuContainer, cartLink);

  const style = document.createElement('style');
  style.id = 'static-mobile-navigation-styles';
  style.textContent = `
    .site-header .menu-toggle {
      display: none;
    }

    .site-header .mobile-nav-links {
      align-items: center;
      gap: 28px;
      display: flex;
    }

    @media (max-width: 700px) {
      .site-header {
        position: relative;
      }

      .site-header .site-nav {
        margin-left: auto;
        gap: 10px;
        position: relative;
      }

      .site-header .menu-toggle {
        width: 42px;
        height: 42px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: #fff;
        color: var(--forest-dark);
        align-items: center;
        justify-content: center;
        flex: none;
        padding: 0;
        font-size: 22px;
        line-height: 1;
        display: inline-flex;
      }

      .site-header .menu-toggle span {
        font-size: 22px !important;
        line-height: 1 !important;
      }

      .site-header .mobile-nav-links {
        display: none;
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        z-index: 1000;
        min-width: 220px;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--paper);
        box-shadow: 0 14px 30px #1634292e;
        align-items: stretch;
        gap: 0;
      }

      .site-header .site-nav.is-open .mobile-nav-links {
        display: flex;
        flex-direction: column;
      }

      .site-header .mobile-nav-links a {
        display: block;
        padding: 12px 14px;
        border-radius: 7px;
        white-space: nowrap;
      }

      .site-header .mobile-nav-links a:hover,
      .site-header .mobile-nav-links a:focus-visible {
        background: var(--cream);
      }
    }
  `;
  document.head.appendChild(style);

  function setMenuOpen(open) {
    nav.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute(
      'aria-label',
      open ? 'Cerrar menú' : 'Abrir menú'
    );
    menuToggle.querySelector('span').textContent = open ? '×' : '☰';
  }

  menuToggle.addEventListener('click', function () {
    setMenuOpen(!nav.classList.contains('is-open'));
  });

  menuContainer.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', function () {
      setMenuOpen(false);
    });
  });

  document.addEventListener('click', function (event) {
    if (!nav.contains(event.target)) {
      setMenuOpen(false);
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      setMenuOpen(false);
      menuToggle.focus();
    }
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 700) {
      setMenuOpen(false);
    }
  });
}


function getEmbeddedProductBySlug(slug) {
  const unified = Array.isArray(window.__catalogProducts)
    ? window.__catalogProducts.find((product) => product.slug === slug)
    : null;

  const product = unified || getEmbeddedProduct('slug', slug);

  return ['UNLISTED', 'NEEDS_REVIEW'].includes(product?.status)
    ? null
    : product;
}


function getEmbeddedProductById(id) {
  const unified = Array.isArray(window.__catalogProducts)
    ? window.__catalogProducts.find((product) => product.id === id)
    : null;

  const product = unified || getEmbeddedProduct('id', id);

  return ['UNLISTED', 'NEEDS_REVIEW'].includes(product?.status)
    ? null
    : product;
}


function getEmbeddedProduct(field, value) {
  const html = document.documentElement.innerHTML;
  const marker = `\\"${field}\\":\\"${value}\\"`;

  const markerIndex = html.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const start = html.lastIndexOf('{\\"id\\":', markerIndex);

  if (start === -1) {
    return null;
  }

  const end = html.indexOf('}', markerIndex);

  if (end === -1) {
    return null;
  }

  const escapedJson = html.slice(start, end + 1);

  try {
    return JSON.parse(
      escapedJson.replace(/\\"/g, '"')
    );
  } catch (error) {
    console.error('No se pudo leer el producto:', error);
    return null;
  }
}


function publicConditionText(value) {
  const text = String(value || '').trim();

  if (
    !text ||
    /estado visual\s+seg[uú]n\s+(?:las\s+)?fotograf[ií]as?/i.test(text)
  ) {
    return '';
  }

  return text;
}


function publicKnownDefectText(value) {
  const text = String(value || '').trim();

  if (
    !text ||
    /^(ninguno|ninguna|sin defectos conocidos)$/i.test(text) ||
    /no se (?:han )?informado defectos/i.test(text)
  ) {
    return '';
  }

  return text;
}


function buildProductDiscovery(catalogProducts, currentProduct, recommendationLimit = 12) {
  const currentId = String(currentProduct?.id || '');
  const currentSlug = String(currentProduct?.slug || '');
  const currentItemNumber = Number(currentProduct?.itemNumber);
  const currentCategory = String(currentProduct?.category || '').trim().toLocaleLowerCase('es');
  const limit = Math.max(0, Number(recommendationLimit) || 0);

  const publicProducts = (Array.isArray(catalogProducts) ? catalogProducts : [])
    .filter((product) => {
      const status = String(product?.status || '').trim().toUpperCase();
      return product?.slug &&
        Number.isFinite(Number(product.itemNumber)) &&
        !['UNLISTED', 'NEEDS_REVIEW'].includes(status);
    })
    .sort((a, b) =>
      Number(a.itemNumber) - Number(b.itemNumber) ||
      String(a.id || a.slug).localeCompare(String(b.id || b.slug))
    );

  const isCurrent = (product) =>
    (currentId && String(product.id || '') === currentId) ||
    (currentSlug && String(product.slug || '') === currentSlug);

  const available = publicProducts.filter(
    (product) => String(product.status || '').trim().toUpperCase() === 'AVAILABLE' && !isCurrent(product)
  );

  const previous = Number.isFinite(currentItemNumber)
    ? available.filter((product) => Number(product.itemNumber) < currentItemNumber).at(-1) || null
    : null;
  const next = Number.isFinite(currentItemNumber)
    ? available.find((product) => Number(product.itemNumber) > currentItemNumber) || null
    : null;

  const rotateAfterCurrent = (products) => {
    if (!Number.isFinite(currentItemNumber)) return products.slice();
    return [
      ...products.filter((product) => Number(product.itemNumber) > currentItemNumber),
      ...products.filter((product) => Number(product.itemNumber) <= currentItemNumber),
    ];
  };

  const sameCategory = available.filter(
    (product) => String(product.category || '').trim().toLocaleLowerCase('es') === currentCategory
  );
  const otherCategories = available.filter(
    (product) => String(product.category || '').trim().toLocaleLowerCase('es') !== currentCategory
  );
  const seen = new Set();
  const recommendations = [];

  for (const product of [
    ...rotateAfterCurrent(sameCategory),
    ...rotateAfterCurrent(otherCategories),
  ]) {
    const key = String(product.id || product.slug);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recommendations.push(product);
    if (recommendations.length >= limit) break;
  }

  return {
    previous,
    next,
    recommendations,
  };
}


function renderProductSequenceLink(product, direction) {
  if (!product) return '';
  const isPrevious = direction === 'previous';
  const label = isPrevious ? 'Anterior' : 'Siguiente';
  const arrowLabel = isPrevious ? '← Anterior' : 'Siguiente →';
  const itemLabel = `Item ${String(product.itemNumber).padStart(3, '0')}`;

  return `
    <a
      class="product-sequence-link ${direction}"
      href="/producto/${encodeURIComponent(product.slug)}"
      aria-label="${escapeHtml(`${label}: ${itemLabel}, ${product.title}`)}"
    >
      <strong>${arrowLabel}</strong>
      <span>${itemLabel} · <b>${escapeHtml(product.title)}</b></span>
    </a>
  `;
}


function renderRelatedProductCard(product) {
  const image = Array.isArray(product.images) ? product.images.find(Boolean) : '';
  const itemLabel = `Item ${String(product.itemNumber).padStart(3, '0')}`;

  return `
    <a
      class="related-product-card"
      href="/producto/${encodeURIComponent(product.slug)}"
      aria-label="Ver ${itemLabel}: ${escapeHtml(product.title)}"
    >
      <span class="related-product-image">
        ${
          image
            ? `<img src="/${stripLeadingSlash(image)}" alt="${escapeHtml(product.title)}" loading="lazy">`
            : ''
        }
      </span>
      <span class="related-product-item">${itemLabel}</span>
      <h3>${escapeHtml(product.title)}</h3>
      <strong class="related-product-price">${formatPYG(product.askingPricePYG)}</strong>
    </a>
  `;
}


function setupRelatedProductsCarousel() {
  const track = document.querySelector('.related-products-track');
  const previous = document.querySelector('[data-related-previous]');
  const next = document.querySelector('[data-related-next]');

  if (!track || !previous || !next) return;

  const cards = [...track.querySelectorAll('.related-product-card')];
  let currentIndex = 0;
  let lastTrackWidth = track.clientWidth;
  let scrollFrame = null;
  let resizeFrame = null;

  function nearestCardIndex() {
    const trackLeft = track.getBoundingClientRect().left;
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    cards.forEach((card, index) => {
      const distance = Math.abs(card.getBoundingClientRect().left - trackLeft);
      if (distance >= nearestDistance) return;
      nearestDistance = distance;
      nearestIndex = index;
    });

    return nearestIndex;
  }

  function syncControls(updateCurrentIndex = true) {
    if (updateCurrentIndex && cards.length) currentIndex = nearestCardIndex();
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    previous.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= maxScroll - 2;
  }

  function alignCurrentCard() {
    const card = cards[currentIndex];
    if (!card) return;

    const trackLeft = track.getBoundingClientRect().left;
    const cardLeft = card.getBoundingClientRect().left;
    lastTrackWidth = track.clientWidth;
    track.scrollTo({
      left: track.scrollLeft + cardLeft - trackLeft,
      behavior: 'auto',
    });
    syncControls(false);
  }

  function scheduleResizeAlignment() {
    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = null;
      alignCurrentCard();
    });
  }

  function move(direction) {
    const pageWidth = Math.max(1, track.clientWidth);
    track.scrollBy({
      left: direction * pageWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  track.addEventListener('scroll', () => {
    if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = null;
      if (Math.abs(track.clientWidth - lastTrackWidth) > 1) {
        scheduleResizeAlignment();
        return;
      }
      syncControls();
    });
  }, { passive: true });

  if (window.__relatedProductsResizeHandler) {
    window.removeEventListener('resize', window.__relatedProductsResizeHandler);
  }
  window.__relatedProductsResizeHandler = scheduleResizeAlignment;
  window.addEventListener('resize', window.__relatedProductsResizeHandler);

  previous.hidden = cards.length <= 4;
  next.hidden = cards.length <= 4;
  syncControls();
}


function shouldSuppressProductArrowNavigation(event, root = document) {
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return true;
  }

  if (root?.querySelector?.('.catalog-lightbox, .image-lightbox, [role="dialog"][aria-modal="true"]')) {
    return true;
  }

  const target = event.target;
  if (!target) return false;
  if (target.isContentEditable) return true;

  return Boolean(target.closest?.([
    'input',
    'textarea',
    'select',
    'button',
    'a[href]',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="button"]',
    '[role="link"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="menu"]',
    '[role="tab"]',
    '[data-photo-index]',
    '.product-gallery',
    '.product-photo-teaser',
    '[data-arrow-key-scope]',
  ].join(',')));
}


function setupProductDiscoveryKeyboard(discovery) {
  if (window.__productDiscoveryKeydownHandler) {
    document.removeEventListener('keydown', window.__productDiscoveryKeydownHandler);
  }

  const previousHref = discovery?.previous
    ? `/producto/${encodeURIComponent(discovery.previous.slug)}`
    : '';
  const nextHref = discovery?.next
    ? `/producto/${encodeURIComponent(discovery.next.slug)}`
    : '';

  window.__productDiscoveryKeydownHandler = function (event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (shouldSuppressProductArrowNavigation(event)) return;

    const destination = event.key === 'ArrowLeft' ? previousHref : nextHref;
    if (!destination) return;

    event.preventDefault();
    window.location.assign(destination);
  };

  document.addEventListener('keydown', window.__productDiscoveryKeydownHandler);
}


function buildWhatsAppProductShareHref(product) {
  const productUrl = new URL(
    '/producto/' + encodeURIComponent(product.slug),
    'https://thelabossieres.com'
  ).toString();
  const message =
    'Mirá este artículo de la venta de mudanza: ' +
    product.title +
    ' · ' +
    formatPYG(product.askingPricePYG) +
    '.\n' +
    productUrl;

  return 'https://wa.me/?text=' + encodeURIComponent(message);
}


function renderProductDetail(product) {
  const main = document.querySelector('main');

  if (!main) {
    return;
  }

  document.title = product.title + ' | Venta de Mudanza';
  document.body.classList.add('product-detail-route');
  document.body.dataset.salePulseProductId = product.id;
  document.body.dataset.salePulseProductSlug = product.slug || '';

  const price = formatPYG(product.askingPricePYG);
  const dueNow = dueNowForProduct(product);
  const balance = product.askingPricePYG - dueNow;
  const discoveryCatalog = Array.isArray(window.__catalogProducts)
    ? window.__catalogProducts
    : [];
  const discovery = buildProductDiscovery(discoveryCatalog, product);
  const sequenceNavigation = `
    <nav
      class="product-sequence-navigation${discoveryCatalog.length ? '' : ' is-pending'}"
      aria-label="Navegar entre productos disponibles"
      ${discoveryCatalog.length ? '' : 'aria-hidden="true"'}
    >
      <div class="product-sequence-slot previous">
        ${renderProductSequenceLink(discovery.previous, 'previous')}
      </div>
      <div class="product-sequence-slot next">
        ${renderProductSequenceLink(discovery.next, 'next')}
      </div>
    </nav>
    <div class="product-sequence-divider" aria-hidden="true"></div>
  `;
  const relatedProducts = discoveryCatalog.length
    ? discovery.recommendations
    : [];

  const statusText =
    product.status === 'SOLD' || product.status === 'PICKED_UP'
      ? 'VENDIDO'
      : product.status !== 'AVAILABLE'
        ? 'NO DISPONIBLE'
        : product.saleMode === 'DELAYED'
          ? 'RETIRO 9–12 DIC.'
          : 'DISPONIBLE AHORA';

  const conditionText =
    publicConditionText(
      product.condition
    );

  const knownDefectText =
    publicKnownDefectText(
      product.knownDefects
    );

  const images = Array.isArray(product.images)
    ? product.images.filter(Boolean)
    : [];

  const gallery = images
    .map((image, index) => {
      return `
        <button
          type="button"
          data-photo-index="${index}"
          aria-label="Ver foto ${index + 1}"
        >
          <img
            src="/${stripLeadingSlash(image)}"
            alt="${escapeHtml(product.title)}"
          >
        </button>
      `;
    })
    .join('');

  const photoTeaser = images
    .slice(0, 2)
    .map((image, index) => `
      <button
        type="button"
        data-photo-index="${index}"
        aria-label="Abrir foto ${index + 1} de ${images.length}"
      >
        <img
          src="/${stripLeadingSlash(image)}"
          alt="${escapeHtml(product.title)}, foto ${index + 1}"
        >
      </button>
    `)
    .join('');

  const accessories =
    product.includedAccessories && product.includedAccessories.length
      ? product.includedAccessories.join(' · ')
      : 'Ninguno indicado';

  const itemLogistics = [
    ...(Array.isArray(product.logisticsNotes)
      ? product.logisticsNotes
      : []),
    product.requiresVehicle
      ? 'Requiere vehículo adecuado.'
      : '',
    product.requiresLoadingHelp
      ? 'El comprador debe traer ayuda para cargar.'
      : '',
  ]
    .map((note) => String(note || '').trim())
    .filter(Boolean)
    .filter(
      (note, index, notes) =>
        notes.indexOf(note) === index
    )
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join('');

  main.innerHTML = `
    <nav class="breadcrumbs" aria-label="Migas de pan">
      <a href="/#articulos">← Volver al catálogo</a>
      <span>/</span>
      <span>${escapeHtml(product.category)}</span>
      <span>/</span>
      <span>${escapeHtml(product.title)}</span>
    </nav>

    ${sequenceNavigation}

    <section class="product-page">
      <aside class="mobile-product-policy" aria-label="Aviso importante sobre la venta">
        <strong>Importante</strong>
        <ul>
          <li>La mayoría de los artículos son usados.</li>
          <li>Todas las ventas son finales.</li>
        </ul>
      </aside>

      <div class="product-detail">
        <div class="product-detail-copy">
          <div class="product-meta detail-meta">
            <span>
              ITEM ${String(product.itemNumber).padStart(3, '0')}
              ·
              ${escapeHtml(product.category)}
            </span>

            <span class="${
              product.status !== 'AVAILABLE'
                ? 'status-unavailable'
                : product.saleMode === 'DELAYED'
                  ? 'status-later'
                  : 'status-now'
            }">
              ${statusText}
            </span>
          </div>

          <h1>${escapeHtml(product.title)}</h1>

          <p class="lead">
            ${escapeHtml(product.description).replace(/\\n/g, '<br>')}
          </p>

          <section class="product-notes" aria-labelledby="product-details-heading">
            <div class="product-notes-heading">
              <span class="section-kicker">DETALLES</span>
              <h2 id="product-details-heading">Lo que tenés que saber</h2>
            </div>

            <dl>
              <div>
                <dt>Estado</dt>
                <dd>${escapeHtml(conditionText || 'Ver estado en las fotos y observaciones.')}</dd>
              </div>

              ${
                product.conditionNotes
                  ? `
                    <div>
                      <dt>Observaciones</dt>
                      <dd>${escapeHtml(product.conditionNotes)}</dd>
                    </div>
                  `
                  : ''
              }

              ${
                knownDefectText
                  ? `
                    <div class="known-defect">
                      <dt>Defectos conocidos</dt>
                      <dd>${escapeHtml(knownDefectText)}</dd>
                    </div>
                  `
                  : ''
              }

              <div>
                <dt>Accesorios incluidos</dt>
                <dd>${escapeHtml(accessories)}</dd>
              </div>

              <div>
                <dt>Disponibilidad</dt>
                <dd>${escapeHtml(statusText)}</dd>
              </div>
            </dl>
          </section>

          ${
            photoTeaser
              ? `
                <section class="product-photo-teaser" aria-labelledby="photo-teaser-heading">
                  <div>
                    <strong id="photo-teaser-heading">Fotos del artículo</strong>
                    <span>Tocá una foto para verla y ampliarla.</span>
                  </div>
                  <div class="product-photo-teaser-grid">${photoTeaser}</div>
                  ${
                    images.length > 1
                      ? `
                        <a
                          class="product-gallery-jump"
                          href="/producto/${encodeURIComponent(product.slug)}#product-gallery"
                        >
                          Ver las ${images.length} fotos <span aria-hidden="true">↓</span>
                        </a>
                      `
                      : ''
                  }
                </section>
              `
              : ''
          }

          <div class="product-price-block">
            ${
              product.originalPricePYG
                ? `<del>${formatPYG(product.originalPricePYG)}</del>`
                : ''
            }

            <strong class="detail-price">
              ${price}
              ${product.quantityTotal > 1 ? ' por unidad' : ''}
            </strong>

            ${
              product.quantityTotal > 1
                ? `<span>${product.quantityRemaining} unidades disponibles</span>`
                : ''
            }
          </div>

          <div class="product-actions">
            <button
              id="product-cart-button"
              class="primary-action"
              type="button"
              ${product.status !== 'AVAILABLE' ? 'disabled' : ''}
            >
              ${
                product.status === 'SOLD' || product.status === 'PICKED_UP'
                  ? 'Vendido'
                  : product.status !== 'AVAILABLE'
                    ? 'No disponible'
                    : product.saleMode === 'DELAYED'
                      ? 'Reservar este artículo'
                      : 'Agregar al carrito'
              }
            </button>

            <div class="product-social-actions">
              <a
                class="secondary-action"
                href="https://wa.me/595972588347?text=${encodeURIComponent(
                  'Hola, quisiera consultar sobre ' +
                  product.title +
                  ' (Item ' +
                  String(product.itemNumber).padStart(3, '0') +
                  ').'
                )}"
                target="_blank"
                rel="noreferrer"
              >
                Consultar por WhatsApp
              </a>

              <a
                class="text-action"
                href="${buildWhatsAppProductShareHref(product)}"
                target="_blank"
                rel="noreferrer"
              >
                <span style="display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <path d="m8.59 13.51 6.83 3.98"></path>
                    <path d="m15.41 6.51-6.82 3.98"></path>
                  </svg>
                  <span>Compartir por WhatsApp</span>
                </span>
              </a>
            </div>
          </div>

          <div class="payment-breakdown">
            <div>
              <span>Precio total</span>
              <strong>${price}</strong>
            </div>

            <div class="due">
              <span>
                ${
                  product.saleMode === 'DELAYED'
                    ? `Reserva hoy (${product.depositPercent}%)`
                    : 'A pagar ahora'
                }
              </span>

              <strong>${formatPYG(dueNow)}</strong>
            </div>

            ${
              balance > 0
                ? `
                  <div>
                    <span>Saldo pendiente</span>
                    <strong>${formatPYG(balance)}</strong>
                  </div>

                  <div>
                    <span>Pago final</span>
                    <strong>${DELAYED_FINAL_PAYMENT_WINDOW}</strong>
                  </div>
                `
                : ''
            }

            <div>
              <span>Retiro</span>
              <strong>
                ${
                  product.saleMode === 'DELAYED'
                    ? formatPickupWindow(
                        product.pickupWindowStart,
                        product.pickupWindowEnd
                      )
                    : 'Disponible después de confirmar el pago'
                }
              </strong>
            </div>
          </div>
        </div>

        <div class="product-detail-left">
          <section class="logistics" aria-labelledby="pickup-heading">
            <strong id="pickup-heading">Para el retiro</strong>
            <div>
              <span class="section-kicker">ESTE ARTÍCULO</span>
              ${
                itemLogistics
                ? `
                  <ul>
                    ${itemLogistics}
                  </ul>
                `
                  : `
                  <ul><li>Sin requisitos especiales de transporte o carga indicados.</li></ul>
                `
            }
            </div>

            <div>
              <span class="section-kicker">REGLAS GENERALES</span>
              <ul>
                <li>Retiro personal en San Lorenzo.</li>
                <li>No hacemos entregas.</li>
                <li>Revisá el artículo antes de llevártelo.</li>
                <li>Una vez retirado, la venta es final.</li>
              </ul>
            </div>
          </section>

          ${
            images.length
              ? `
                <section id="product-gallery" class="product-gallery" aria-labelledby="full-gallery-heading">
                  <div class="product-gallery-heading">
                    <span class="section-kicker">FOTOS</span>
                    <h2 id="full-gallery-heading">Galería completa</h2>
                  </div>

                  <button class="main-image" type="button" data-photo-index="0">
                    <img
                      id="main-product-image"
                      src="/${stripLeadingSlash(images[0])}"
                      alt="${escapeHtml(product.title)}"
                    >
                  </button>

                  ${
                    images.length > 1
                      ? `<div class="product-gallery-thumbnails">${gallery}</div>`
                      : ''
                  }
                </section>
              `
              : ''
          }
        </div>

        <p class="reservation-rule">
          Un mensaje no reserva el artículo. La reserva queda confirmada
          únicamente después de que confirmemos el pago.
        </p>
      </div>

      ${
        relatedProducts.length
          ? `
            <section class="related-products" aria-labelledby="related-products-heading">
              <div class="related-products-heading">
                <div>
                  <span class="section-kicker">SEGUÍ EXPLORANDO</span>
                  <h2 id="related-products-heading">También te puede interesar</h2>
                </div>
                <div class="related-products-controls" aria-label="Navegar recomendaciones">
                  <button type="button" data-related-previous aria-label="Recomendaciones anteriores">←</button>
                  <button type="button" data-related-next aria-label="Más recomendaciones">→</button>
                </div>
              </div>
              <div class="related-products-track">
                ${relatedProducts.map(renderRelatedProductCard).join('')}
              </div>
              <a class="related-products-more" href="/#articulos">Ver más productos →</a>
            </section>
          `
          : ''
      }

      <a class="product-back-link" href="/#articulos">
        ← Volver al catálogo
      </a>
    </section>
  `;

  document.documentElement.classList.remove('product-route-pending');
  window.dispatchEvent(new CustomEvent('sale-pulse:product-view', {
    detail: { product },
  }));
  setupProductCartButton(product);
  setupProductDiscoveryKeyboard(discoveryCatalog.length ? discovery : null);
  setupRelatedProductsCarousel();
}


function renderCartPage() {
  const main = document.querySelector('main');

  if (!main) {
    return;
  }

  document.title = 'Carrito | Venta de Mudanza';

  const cart = getStaticCart();

  const products = cart.ids
    .map((id) => getEmbeddedProductById(id))
    .filter(Boolean);

  if (!cart.ids.length) {
    main.innerHTML = `
      <section class="empty-cart">
        <span>Tu carrito</span>
        <h1>Todavía no agregaste artículos.</h1>
        <p>
          Explorá el catálogo y elegí artículos para una compra inmediata
          o una reserva.
        </p>
        <a class="primary-action" href="/#articulos">
          Ver artículos
        </a>
      </section>
    `;

    updateStaticCartCount();
    completeCartRoute();
    return;
  }

  if (products.length !== cart.ids.length) {
    renderCartLoadError(
      'No se pudieron cargar todos tus artículos.',
      'No mostramos un carrito incompleto. Intentá nuevamente en unos minutos.'
    );
    return;
  }

  const totals = products.reduce(
    (sum, product) => {
      const quantity = getCartQuantity(product);
      const due = dueNowForProduct(product);

      sum.total += product.askingPricePYG * quantity;
      sum.due += due * quantity;
      sum.balance += (product.askingPricePYG - due) * quantity;

      return sum;
    },
    {
      total: 0,
      due: 0,
      balance: 0,
    }
  );

  const hasUnavailable = products.some(
    (product) =>
      product.status !== 'AVAILABLE' ||
      Number(product.quantityRemaining || 0) < 1
  );

  const itemsHtml = products
    .map((product) => renderCartItem(product))
    .join('');

  main.innerHTML = `
    <section class="cart-page">
    <div class="page-heading">
      <span class="section-kicker">TU SELECCIÓN</span>
      <h1>Carrito</h1>
      <p>
        Revisá los artículos y los importes antes de continuar.
      </p>
    </div>

    <div class="cart-layout">

      <section
        class="cart-items"
        aria-label="Artículos en el carrito"
      >
        ${itemsHtml}
      </section>

      <aside class="cart-summary">
        <span class="section-kicker">RESUMEN</span>

        <h2>Lo que vas a pagar</h2>

        ${cart.expiresAt ? reservationCardHtml('Completá tu compra') : ''}

        <dl>
          <div>
            <dt>Valor total de los artículos</dt>
            <dd>${formatPYG(totals.total)}</dd>
          </div>

          <div class="summary-due">
            <dt>A pagar ahora</dt>
            <dd>${formatPYG(totals.due)}</dd>
          </div>

          <div>
            <dt>Saldo pendiente</dt>
            <dd>${formatPYG(totals.balance)}</dd>
          </div>
        </dl>

        ${
          totals.balance > 0
            ? `
              <div class="cart-payment-window">
                <strong>Pago final del saldo pendiente</strong>
                <span>${DELAYED_FINAL_PAYMENT_WINDOW}</span>
              </div>
            `
            : ''
        }

        <div class="pickup-confirm">
          <strong>Retiro únicamente</strong>
          <span>${NO_DELIVERY_NOTICE}</span>
        </div>

        <div class="pickup-confirm final-sale-notice">
          <strong>${FINAL_SALE_SHORT_NOTICE}</strong>
          <span>Revisá los artículos al retirarlos. Una vez que salen de nuestro domicilio, no aceptamos cambios, devoluciones ni reembolsos.</span>
          ${products.some((product) => product.saleMode === 'DELAYED') ? `<span>${DELAYED_PICKUP_NOTICE}</span>` : ''}
        </div>

        ${
          hasUnavailable
            ? `
              <p class="form-error" role="alert">
                Hay un artículo que ya no está disponible.
                Quitalo del carrito antes de continuar.
              </p>
            `
            : ''
        }

        <a
          class="primary-action"
          href="${hasUnavailable ? '#' : '/checkout'}"
          ${hasUnavailable ? 'aria-disabled="true"' : ''}
          id="continue-checkout"
        >
          Continuar con la compra
        </a>

        <button
          class="text-action"
          type="button"
          id="clear-cart"
        >
          Vaciar carrito
        </button>

        <small>
          En el siguiente paso confirmaremos tus datos y la forma de pago.
        </small>
      </aside>

    </div>
    </section>
  `;

  setupCartPageEvents(hasUnavailable);
  startCartCountdown(cart);
  updateStaticCartCount();
  completeCartRoute();
}


function startCartCountdown(cart) {
  if (cart?.expiresAt) startCartReservationCountdown(cart.expiresAt);
}


function renderCartItem(product) {
  const quantity = getCartQuantity(product);
  const due = dueNowForProduct(product);

  const maxQuantity = Math.max(
    1,
    Number(product.quantityRemaining || 1)
  );

  const quantityOptions = Array.from(
    { length: maxQuantity },
    (_, index) => index + 1
  )
    .map(
      (number) => `
        <option
          value="${number}"
          ${number === quantity ? 'selected' : ''}
        >
          ${number}
        </option>
      `
    )
    .join('');

  const unavailable =
    product.status !== 'AVAILABLE' ||
    Number(product.quantityRemaining || 0) < 1;

  return `
    <article data-cart-product="${escapeHtml(product.id)}">

      <a href="/producto/${encodeURIComponent(product.slug)}">
        <img
          src="/${stripLeadingSlash(product.images?.[0] || '')}"
          alt="${escapeHtml(product.title)}"
        >
      </a>

      <div class="cart-item-main">
        <span class="${
          unavailable
            ? 'status-unavailable'
            : product.saleMode === 'IMMEDIATE'
              ? 'status-now'
              : 'status-later'
        }">
          ${
            unavailable
              ? 'NO DISPONIBLE'
              : product.saleMode === 'IMMEDIATE'
                ? 'DISPONIBLE AHORA'
                : 'RETIRO POSTERIOR'
          }
        </span>

        <h2>
          <a href="/producto/${encodeURIComponent(product.slug)}">
            ${escapeHtml(product.title)}
          </a>
        </h2>

        <p>${escapeHtml(product.condition)}</p>

        ${
          product.quantityTotal > 1 && !unavailable
            ? `
              <label>
                Cantidad

                <select
                  data-cart-quantity="${escapeHtml(product.id)}"
                >
                  ${quantityOptions}
                </select>
              </label>
            `
            : ''
        }

        <button
          type="button"
          data-cart-remove="${escapeHtml(product.id)}"
        >
          Quitar
        </button>
      </div>

      <dl>
        <div>
          <dt>
            Precio${product.quantityTotal > 1 ? ' por unidad' : ''}
          </dt>
          <dd>${formatPYG(product.askingPricePYG)}</dd>
        </div>

        <div class="highlight">
          <dt>A pagar ahora</dt>
          <dd>${formatPYG(due * quantity)}</dd>
        </div>

        ${
          product.askingPricePYG > due
            ? `
              <div>
                <dt>Saldo pendiente</dt>
                <dd>
                  ${formatPYG(
                    (product.askingPricePYG - due) * quantity
                  )}
                </dd>
              </div>

              <div>
                <dt>Pago final</dt>
                <dd>${DELAYED_FINAL_PAYMENT_WINDOW}</dd>
              </div>

              <div>
                <dt>Retiro</dt>
                <dd>
                  ${formatPickupWindow(
                    product.pickupWindowStart,
                    product.pickupWindowEnd
                  )}
                </dd>
              </div>
            `
            : ''
        }
      </dl>

    </article>
  `;
}


function setupCartPageEvents(hasUnavailable) {
  document
    .querySelectorAll('[data-cart-remove]')
    .forEach((button) => {
      button.addEventListener('click', async function () {
        button.disabled = true;
        await removeStaticCartItem(
          button.getAttribute('data-cart-remove')
        );

        await renderCartPage();
      });
    });

  document
    .querySelectorAll('[data-cart-quantity]')
    .forEach((select) => {
      select.addEventListener('change', async function () {
        select.disabled = true;
        await setStaticCartQuantity(
          select.getAttribute('data-cart-quantity'),
          Number(select.value)
        );

        await renderCartPage();
      });
    });

  const clearButton = document.getElementById('clear-cart');

  if (clearButton) {
    clearButton.addEventListener('click', async function () {
      clearButton.disabled = true;
      await clearStaticCart();
      await renderCartPage();
    });
  }

  const continueButton =
    document.getElementById('continue-checkout');

  if (continueButton && hasUnavailable) {
    continueButton.addEventListener('click', function (event) {
      event.preventDefault();
    });
  }
}


function enhanceCatalogCardNavigation(card, productLink, product) {
  const href = productLink.getAttribute('href') || '';

  card.dataset.productId = product.id;

  const photoButton = card.querySelector('button.product-photo');
  if (photoButton) {
    const photoSurface = document.createElement('div');
    photoSurface.className = photoButton.className;
    photoSurface.setAttribute('aria-hidden', 'true');
    while (photoButton.firstChild) {
      photoSurface.appendChild(photoButton.firstChild);
    }
    photoButton.replaceWith(photoSurface);
  }

  card.querySelectorAll('.image-enlarge-hint').forEach((hint) => hint.remove());

  card.querySelectorAll('a[href^="/producto/"]').forEach((link) => {
    const replacement = document.createElement('span');
    if (link.closest('.card-detail-row')) {
      replacement.className = 'card-detail-link';
    }
    while (link.firstChild) {
      replacement.appendChild(link.firstChild);
    }
    link.replaceWith(replacement);
  });

  const cardLink = document.createElement('a');
  cardLink.className = 'product-card-link';
  cardLink.href = href;
  cardLink.dataset.productCardLink = '';
  cardLink.setAttribute('aria-label', `Ver detalles de ${product.title}`);
  cardLink.addEventListener('click', function () {
    window.persistCatalogHistoryState?.();
  });
  card.insertBefore(cardLink, card.firstChild);
}


function setupCatalogCartButtons() {
  const cards = document.querySelectorAll('.product-card');

  cards.forEach((card) => {
    const actionButton =
      card.querySelector('.card-actions button');

    const productLink =
      card.querySelector('a[href^="/producto/"]');

    if (!actionButton || !productLink) {
      return;
    }

    const href = productLink.getAttribute('href') || '';
    const slug = decodeURIComponent(
      href.replace('/producto/', '')
    );

    const product = getEmbeddedProductBySlug(slug);

    if (!product) {
      return;
    }

    enhanceCatalogCardNavigation(card, productLink, product);

    if (product.status !== 'AVAILABLE') {
      actionButton.disabled = true;
      return;
    }

    function refreshCatalogButton() {
      if (staticCartHas(product.id)) {
        actionButton.textContent = 'En carrito';
        actionButton.disabled = true;
      }
    }

    refreshCatalogButton();

    actionButton.addEventListener('click', async function () {
      actionButton.disabled = true;
      const added = await addStaticCartItem(
        product.id,
        window.salePulseCartContext?.(product.id) || null
      );
      if (added) {
        actionButton.textContent = 'En carrito';
      } else {
        actionButton.disabled = false;
      }
    });
  });
}


function setupProductCartButton(product) {
  const button =
    document.getElementById('product-cart-button');

  if (!button || product.status !== 'AVAILABLE') {
    return;
  }

  function refreshButton() {
    if (staticCartHas(product.id)) {
      button.textContent = 'Ya está en el carrito';
      button.disabled = true;
    }
  }

  refreshButton();

  button.addEventListener('click', async function () {
    button.disabled = true;
    const added = await addStaticCartItem(
      product.id,
      window.salePulseCartContext?.(product.id) || null
    );
    if (added) button.textContent = 'Ya está en el carrito';
    else button.disabled = false;
  });
}


function getStaticCart() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(STATIC_CART_KEY) ||
      '{"ids":[],"quantities":{}}'
    );

    if (Array.isArray(stored)) {
      return {
        createdAt: null,
        expiresAt: null,
        ids: stored.filter(
          (id) => typeof id === 'string'
        ),
        quantities: Object.fromEntries(
          stored
            .filter((id) => typeof id === 'string')
            .map((id) => [id, 1])
        ),
      };
    }

    return {
      createdAt: Number(stored.createdAt || 0) || null,
      expiresAt: Number(stored.expiresAt || 0) || null,
      ids: Array.isArray(stored.ids)
        ? stored.ids
        : [],

      quantities:
        stored.quantities &&
        typeof stored.quantities === 'object'
          ? stored.quantities
          : {},
    };
  } catch {
    return {
      createdAt: null,
      expiresAt: null,
      ids: [],
      quantities: {},
    };
  }
}


function setStaticCartFromLease(lease) {
  if (getStaticCart().expiresAt !== lease.expiresAt) localStorage.removeItem('mudanza-cart-checkout-id');
  saveStaticCart({
    createdAt: lease.createdAt,
    expiresAt: lease.expiresAt,
    ids: Object.keys(lease.items || {}),
    quantities: lease.items || {},
  });
  refreshCartReservationUi();
  startCartReservationCountdown(lease.expiresAt);
  clearTimeout(setStaticCartFromLease.expiryTimer);
  const expectedExpiration = Number(lease.expiresAt);
  setStaticCartFromLease.expiryTimer = setTimeout(
    () => {
      if (Number(getStaticCart().expiresAt) !== expectedExpiration) return;
      void synchronizeExpiredCart(expectedExpiration);
    },
    Math.max(0, expectedExpiration - Date.now() + 50)
  );
}


async function syncStaticCartFromServer({ migrateLegacy = false } = {}) {
  const local = getStaticCart();
  window.__staticCartSynchronized = false;
  try {
    const response = await fetch('/api/cart/reservation', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo consultar la reserva.');
    window.__staticCartSynchronized = true;
    window.__checkoutRecovery = result.checkoutRecovery || null;
    if (result.checkoutRecovery) {
      localStorage.setItem('mudanza-last-order', JSON.stringify({ id: result.checkoutRecovery.orderId, access: result.checkoutRecovery.accessToken }));
      saveStaticCart({ expiresAt: null, ids: [], quantities: {} });
      clearCartReservationUi();
      localStorage.removeItem('mudanza-cart-checkout-id');
      if (typeof installMyOrderLink === 'function') installMyOrderLink();
      return null;
    }
    if (result.lease) {
      setStaticCartFromLease(result.lease);
      return result.lease;
    }
    if (result.expiredAt) {
      saveStaticCart({ expiresAt: null, ids: [], quantities: {} });
      clearCartReservationUi();
      showCartExpirationDialog(result.expiredAt);
      return null;
    }
    if (migrateLegacy && local.ids.length) {
      try {
        for (const productId of local.ids) {
          const claim = await postCartReservation('claim', {
            productId,
            quantity: Number(local.quantities[productId] || 1),
          });
          if (!claim.ok) throw new Error(claim.error || 'No se pudo reservar el artículo.');
        }
      } catch (error) {
        await postCartReservation('release-all').catch(() => {});
        saveStaticCart({ expiresAt: null, ids: [], quantities: {} });
        throw error;
      }
      const refreshed = await fetch('/api/cart/reservation', { cache: 'no-store' });
      const current = await refreshed.json();
      if (!refreshed.ok) throw new Error(current.error || 'No se pudo confirmar la reserva.');
      if (current.lease) {
        setStaticCartFromLease(current.lease);
        return current.lease;
      }
    }
    if (local.ids.length) saveStaticCart({ expiresAt: null, ids: [], quantities: {} });
    clearCartReservationUi();
    return null;
  } catch (error) {
    window.__staticCartSynchronized = false;
    showCartNotice(error instanceof Error ? error.message : 'No se pudo consultar la reserva.');
    return null;
  }
}


async function postCartReservation(action, payload = {}) {
  const response = await fetch('/api/cart/reservation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json();
  return { ...result, ok: response.ok };
}


function addToCartErrorContent(message) {
  const text = String(message || '').trim();
  const normalized = text.toLocaleLowerCase('es');

  if (
    normalized.includes('temporalmente reservado') ||
    normalized.includes('reservado por otro comprador') ||
    normalized.includes('reservado por otra persona')
  ) {
    return {
      title: 'Este artículo ya está reservado',
      body: 'Otra persona lo tiene reservado temporalmente en este momento.',
    };
  }

  if (
    normalized.includes('ya no está disponible') ||
    normalized.includes('no está disponible') ||
    normalized.includes('no encontramos el inventario')
  ) {
    return {
      title: 'Este artículo ya no está disponible',
      body: 'El artículo no se agregó al carrito.',
    };
  }

  if (
    normalized.includes('sesión del carrito venció') ||
    normalized.includes('reserva temporal venció') ||
    normalized.includes('carrito venció')
  ) {
    return {
      title: 'La sesión del carrito venció',
      body: 'El artículo no se agregó al carrito.',
    };
  }

  if (normalized.includes('ventas todavía no están abiertas')) {
    return {
      title: 'Las ventas todavía no están abiertas',
      body: 'El artículo no se agregó al carrito.',
    };
  }

  return {
    title: 'No pudimos agregar el artículo',
    body: 'Hubo un problema temporal y el artículo no se agregó al carrito.',
  };
}


function showAddToCartErrorDialog(message, returnFocusTo = document.activeElement) {
  const previous = document.getElementById('add-to-cart-error-backdrop');
  if (previous) previous.remove();

  const content = addToCartErrorContent(message);
  const previousOverflow = document.documentElement.style.overflow;
  const backdrop = document.createElement('div');
  const dialog = document.createElement('section');
  const title = document.createElement('h2');
  const body = document.createElement('p');
  const acknowledge = document.createElement('button');

  backdrop.id = 'add-to-cart-error-backdrop';
  backdrop.className = 'add-to-cart-error-backdrop';
  dialog.className = 'add-to-cart-error-dialog';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'add-to-cart-error-title');
  dialog.setAttribute('aria-describedby', 'add-to-cart-error-body');
  title.id = 'add-to-cart-error-title';
  title.textContent = content.title;
  body.id = 'add-to-cart-error-body';
  body.textContent = content.body;
  acknowledge.type = 'button';
  acknowledge.textContent = 'Entendido';

  dialog.append(title, body, acknowledge);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  document.documentElement.style.overflow = 'hidden';

  const close = () => {
    backdrop.remove();
    document.documentElement.style.overflow = previousOverflow;
    if (
      returnFocusTo &&
      returnFocusTo.isConnected &&
      typeof returnFocusTo.focus === 'function'
    ) {
      returnFocusTo.focus({ preventScroll: true });
    }
  };

  acknowledge.addEventListener('click', close, { once: true });
  backdrop.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    acknowledge.focus();
  });

  window.requestAnimationFrame(() => acknowledge.focus());
}


function showReservationDialog({ id, title, body, primaryLabel, primaryHref, secondaryLabel = '' }, returnFocusTo = document.activeElement) {
  const previous = document.getElementById(id);
  if (previous) previous.remove();

  const previousOverflow = document.documentElement.style.overflow;
  const backdrop = document.createElement('div');
  const dialog = document.createElement('section');
  const heading = document.createElement('h2');
  const message = document.createElement('p');
  const actions = document.createElement('div');
  const primary = document.createElement('button');
  const secondary = secondaryLabel ? document.createElement('button') : null;

  backdrop.id = id;
  backdrop.className = 'reservation-modal-backdrop';
  dialog.className = 'reservation-modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-body`);
  heading.id = `${id}-title`;
  heading.textContent = title;
  message.id = `${id}-body`;
  message.textContent = body;
  actions.className = 'reservation-modal-actions';
  primary.type = 'button';
  primary.className = 'primary-action';
  primary.textContent = primaryLabel;
  actions.appendChild(primary);
  if (secondary) {
    secondary.type = 'button';
    secondary.className = 'secondary-action';
    secondary.textContent = secondaryLabel;
    actions.appendChild(secondary);
  }
  dialog.append(heading, message, actions);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  document.documentElement.style.overflow = 'hidden';

  const focusable = secondary ? [primary, secondary] : [primary];
  const close = () => {
    backdrop.remove();
    document.documentElement.style.overflow = previousOverflow;
    if (returnFocusTo?.isConnected && typeof returnFocusTo.focus === 'function') {
      returnFocusTo.focus({ preventScroll: true });
    }
  };
  primary.addEventListener('click', () => {
    close();
    window.location.assign(primaryHref);
  }, { once: true });
  secondary?.addEventListener('click', close, { once: true });
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && secondary) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const currentIndex = focusable.indexOf(document.activeElement);
    const direction = event.shiftKey ? -1 : 1;
    focusable[(currentIndex + direction + focusable.length) % focusable.length].focus();
  });
  window.requestAnimationFrame(() => primary.focus());
}


function showAddToCartSuccessDialog(lease, returnFocusTo) {
  showReservationDialog({
    id: 'add-to-cart-success-backdrop',
    title: 'Artículo reservado por 2 horas',
    body: `Podés seguir mirando. Para conservarlo, completá tu compra antes de ${formatReservationDeadline(lease.expiresAt)}.`,
    primaryLabel: 'Ir al carrito',
    primaryHref: '/carrito',
    secondaryLabel: 'Seguir mirando',
  }, returnFocusTo);
}


function showApproachingExpirationDialog(expiresAt) {
  const key = String(expiresAt);
  if (!rememberOneTimeEvent(CART_WARNING_DEADLINES_KEY, key)) return;
  showReservationDialog({
    id: 'cart-expiring-backdrop',
    title: 'Tu reserva vence pronto',
    body: 'Te quedan aproximadamente 15 minutos para completar tu compra.',
    primaryLabel: 'Ir al carrito',
    primaryHref: '/carrito',
    secondaryLabel: 'Seguir mirando',
  });
}


function showCartExpirationDialog(expiredAt) {
  const key = String(expiredAt);
  if (!rememberOneTimeEvent(CART_EXPIRATION_EVENTS_KEY, key)) return;
  showReservationDialog({
    id: 'cart-expired-backdrop',
    title: 'Tu reserva venció',
    body: 'Los artículos de este carrito fueron liberados y pueden estar disponibles para otros compradores.',
    primaryLabel: 'Volver al catálogo',
    primaryHref: '/#articulos',
  });
}


function rememberOneTimeEvent(storageKey, eventKey) {
  let values = [];
  try {
    values = JSON.parse(localStorage.getItem(storageKey) || '[]');
  } catch {}
  if (!Array.isArray(values)) values = [];
  if (values.includes(eventKey)) return false;
  localStorage.setItem(storageKey, JSON.stringify([...values.slice(-19), eventKey]));
  return true;
}


function storefrontSupportsCartBanner() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/' || path === '/index.html' || path === '/carrito' || path === '/checkout' || path.startsWith('/producto/');
}


function reservationCardHtml(actionText) {
  return `
    <section class="reservation-deadline-card" data-reservation-card aria-label="Reserva del carrito">
      <span>Tus artículos están reservados</span>
      <strong data-reservation-remaining></strong>
      <p>${actionText} antes de <b data-reservation-deadline></b>.</p>
    </section>
  `;
}


function installCartReservationBanner() {
  if (!storefrontSupportsCartBanner()) return null;
  let banner = document.getElementById('cart-reservation-banner');
  if (banner) return banner;
  const header = document.querySelector('.site-header');
  if (!header?.parentElement) return null;
  banner = document.createElement('aside');
  banner.id = 'cart-reservation-banner';
  banner.className = 'cart-reservation-banner';
  banner.setAttribute('aria-label', 'Reserva activa del carrito');
  banner.innerHTML = `
    <div>
      <span>Tus artículos están reservados</span>
      <strong data-reservation-remaining></strong>
      <p>Completá tu compra antes de <b data-reservation-deadline></b>.</p>
      <a href="/carrito">Ir al carrito</a>
    </div>
  `;
  header.insertAdjacentElement('afterend', banner);
  return banner;
}


function clearCartReservationUi() {
  clearInterval(startCartReservationCountdown.timer);
  document.getElementById('cart-reservation-banner')?.remove();
}


function refreshCartReservationUi() {
  const cart = getStaticCart();
  if (!cart.expiresAt || !cart.ids.length) {
    clearCartReservationUi();
    return;
  }
  installCartReservationBanner();
  updateCartReservationDisplays(cart.expiresAt);
}


function updateCartReservationDisplays(expiresAt) {
  const remainingText = formatReservationRemaining(Number(expiresAt) - Date.now());
  const deadlineText = formatReservationDeadline(expiresAt);
  document.querySelectorAll('[data-reservation-remaining]').forEach((node) => {
    node.textContent = remainingText;
  });
  document.querySelectorAll('[data-reservation-deadline]').forEach((node) => {
    node.textContent = deadlineText;
  });
}


function formatReservationRemaining(milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(Number(milliseconds) / 60000));
  if (totalMinutes < 1) return 'Menos de 1 min restante';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  return `${parts.join(' ')} ${totalMinutes === 1 ? 'restante' : 'restantes'}`;
}


function zonedDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RESERVATION_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Number(value)));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}


function formatReservationDeadline(value, nowValue = Date.now()) {
  const expiration = Number(value);
  const time = new Intl.DateTimeFormat('es-PY', {
    timeZone: RESERVATION_TIME_ZONE,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(expiration));
  const todayKey = zonedDateKey(nowValue);
  const expirationKey = zonedDateKey(expiration);
  const tomorrow = new Date(Number(nowValue) + 24 * 60 * 60 * 1000);
  if (expirationKey === todayKey) return `hoy a las ${time}`;
  if (expirationKey === zonedDateKey(tomorrow)) return `mañana a las ${time}`;
  const date = new Intl.DateTimeFormat('es-PY', {
    timeZone: RESERVATION_TIME_ZONE,
    day: 'numeric', month: 'long',
  }).format(new Date(expiration));
  return `el ${date} a las ${time}`;
}


async function synchronizeExpiredCart(expectedExpiration) {
  if (Number(getStaticCart().expiresAt) !== Number(expectedExpiration)) return;
  await syncStaticCartFromServer();
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/carrito') await renderSynchronizedCartPage();
  if (path === '/checkout' && typeof renderCheckoutPage === 'function') await renderCheckoutPage();
}


function startCartReservationCountdown(expiresAt) {
  clearInterval(startCartReservationCountdown.timer);
  const expectedExpiration = Number(expiresAt);
  const update = () => {
    if (Number(getStaticCart().expiresAt) !== expectedExpiration) {
      clearInterval(startCartReservationCountdown.timer);
      return;
    }
    const remaining = expectedExpiration - Date.now();
    if (remaining <= 0) {
      clearInterval(startCartReservationCountdown.timer);
      void synchronizeExpiredCart(expectedExpiration);
      return;
    }
    refreshCartReservationUi();
    if (remaining <= 15 * 60 * 1000) showApproachingExpirationDialog(expectedExpiration);
  };
  update();
  startCartReservationCountdown.timer = setInterval(update, 1000);
}


function showCartNotice(message) {
  let notice = document.getElementById('cart-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'cart-notice';
    notice.setAttribute('role', 'alert');
    notice.setAttribute('aria-live', 'assertive');
    Object.assign(notice.style, {
      position: 'fixed', bottom: '18px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '10000', width: 'min(92vw, 620px)', padding: '14px 18px',
      borderRadius: '10px', background: '#263d32', color: '#fff', boxShadow: '0 8px 24px #0003',
      fontSize: '14px', fontWeight: '700', textAlign: 'center',
    });
    document.body.appendChild(notice);
  }
  notice.textContent = message;
  clearTimeout(showCartNotice.timer);
  showCartNotice.timer = setTimeout(() => notice.remove(), 6000);
}


window.addEventListener('storage', async function (event) {
  if (event.key !== STATIC_CART_KEY) return;
  await syncStaticCartFromServer();
  updateStaticCartCount();
  if ((window.location.pathname.replace(/\/+$/, '') || '/') === '/carrito') {
    await renderSynchronizedCartPage();
  }
});


function saveStaticCart(cart) {
  localStorage.setItem(
    STATIC_CART_KEY,
    JSON.stringify(cart)
  );

  updateStaticCartCount();
  if (!cart?.expiresAt || !cart?.ids?.length) clearCartReservationUi();
}


async function addStaticCartItem(productId, analytics = null) {
  const returnFocusTo = document.activeElement;
  const cart = getStaticCart();
  if (cart.ids.includes(productId)) return true;
  saveStaticCart(cart);
  try {
    const trackingContext = analytics || window.salePulseCartContext?.(productId) || null;
    const result = await postCartReservation('claim', {
      productId,
      quantity: 1,
      ...(trackingContext ? { analytics: trackingContext } : {}),
    });
    if (!result.ok) throw new Error(result.error || 'No se pudo reservar el artículo.');
    setStaticCartFromLease(result.lease);
    showAddToCartSuccessDialog(result.lease, returnFocusTo);
    return true;
  } catch (error) {
    showAddToCartErrorDialog(
      error instanceof Error
        ? error.message
        : 'No se pudo reservar el artículo.',
      returnFocusTo
    );
    return false;
  }
}


async function removeStaticCartItem(productId) {
  const cart = getStaticCart();
  try {
    const result = await postCartReservation('release', { productId });
    if (!result.ok) throw new Error(result.error || 'No se pudo liberar el artículo.');
    if (result.lease) setStaticCartFromLease(result.lease);
    else saveStaticCart({ expiresAt: null, ids: [], quantities: {} });
  } catch (error) {
    showCartNotice(error instanceof Error ? error.message : 'No se pudo liberar el artículo.');
  }
}


async function clearStaticCart() {
  const cart = getStaticCart();
  try {
    const result = await postCartReservation('release-all');
    if (!result.ok) throw new Error(result.error || 'No se pudo liberar el carrito.');
    saveStaticCart({ expiresAt: null, ids: [], quantities: {} });
  } catch (error) {
    showCartNotice(error instanceof Error ? error.message : 'No se pudo liberar el carrito.');
  }
}


async function setStaticCartQuantity(productId, quantity) {
  const cart = getStaticCart();
  const product = getEmbeddedProductById(productId);

  if (!product) {
    return;
  }

  const maxQuantity = Math.max(
    1,
    Number(product.quantityRemaining || 1)
  );

  const nextQuantity = Math.min(
    maxQuantity,
    Math.max(1, Math.floor(quantity))
  );
  try {
    const result = await postCartReservation('quantity', { productId, quantity: nextQuantity });
    if (!result.ok) throw new Error(result.error || 'No se pudo actualizar la cantidad.');
    if (result.lease) setStaticCartFromLease(result.lease);
  } catch (error) {
    showCartNotice(error instanceof Error ? error.message : 'No se pudo actualizar la cantidad.');
    await syncStaticCartFromServer();
  }
}


function getCartQuantity(product) {
  const cart = getStaticCart();

  const requested = Number(
    cart.quantities[product.id] || 1
  );

  const maximum = Math.max(
    1,
    Number(product.quantityRemaining || 1)
  );

  return Math.min(
    maximum,
    Math.max(1, Math.floor(requested))
  );
}


function staticCartHas(productId) {
  return getStaticCart().ids.includes(productId);
}


function updateStaticCartCount() {
  const cart = getStaticCart();

  const total = cart.ids.reduce(
    (sum, id) =>
      sum + Number(cart.quantities[id] || 1),
    0
  );

  const counter =
    document.querySelector('.cart-link span');

  if (counter) {
    counter.textContent = String(total);
  }
}


function dueNowForProduct(product) {
  if (product.saleMode === 'DELAYED') {
    return Math.round(
      product.askingPricePYG *
      (Number(product.depositPercent || 0) / 100)
    );
  }

  return Number(product.askingPricePYG || 0);
}


function formatPYG(value) {
  return (
    'Gs. ' +
    Number(value || 0).toLocaleString('es-PY')
  );
}


function formatPickupWindow(start, end) {
  if (!start || !end) {
    return 'Fecha a coordinar';
  }

  const startDate =
    new Date(start + 'T12:00:00');

  const endDate =
    new Date(end + 'T12:00:00');

  const startDay = startDate.getDate();
  const endDay = endDate.getDate();

  const month =
    endDate.toLocaleDateString('es-PY', {
      month: 'long',
    });

  return `${startDay}–${endDay} ${month} ${endDate.getFullYear()}`;
}


function stripLeadingSlash(value) {
  return String(value || '').replace(/^\/+/, '');
}


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
