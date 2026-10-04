// File: js/site.js

const STATIC_CART_KEY = 'mudanza-demo-cart';
const DELAYED_FINAL_PAYMENT_WINDOW = '1–8 diciembre 2026';
const FINAL_SALE_POLICY_VERSION = '2026-10-02-v1';
const FINAL_SALE_SHORT_NOTICE = 'Importante: La mayoría de los artículos son usados. Todas las ventas son finales.';
const NO_DELIVERY_NOTICE = 'No realizamos entregas. El comprador debe retirar su compra en nuestro domicilio en la fecha correspondiente.';
const DELAYED_PICKUP_NOTICE = 'Aunque el artículo esté pagado, si está marcado para retiro posterior deberá permanecer con nosotros hasta la fecha de retiro indicada.';
window.__staticCartReady = syncStaticCartFromServer({ migrateLegacy: true });

window.addEventListener('load', async function () {
  setupStaticMobileNavigation();

  await window.__staticCartReady;
  updateStaticCartCount();

  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (path === '/carrito') {
    await renderCartPage();
    return;
  }

  if (path.startsWith('/producto/')) {
    const slug = decodeURIComponent(path.slice('/producto/'.length));
    const product = getEmbeddedProductBySlug(slug);

    if (!product) {
      console.error('No se encontró el producto:', slug);
      return;
    }

    renderProductDetail(product);
    return;
  }

  if (path === '/' || path === '/index.html') {
    setupCatalogCartButtons();
  }
});


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


function renderProductDetail(product) {
  const main = document.querySelector('main');

  if (!main) {
    return;
  }

  document.title = product.title + ' | Venta de Mudanza';

  const price = formatPYG(product.askingPricePYG);
  const dueNow = dueNowForProduct(product);
  const balance = product.askingPricePYG - dueNow;

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

  const gallery = (product.images || [])
    .map((image, index) => {
      return `
        <button
          type="button"
          onclick="document.getElementById('main-product-image').src='/${stripLeadingSlash(image)}'"
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

    <section class="product-page">
      <aside class="mobile-product-policy" aria-label="Aviso importante sobre la venta">
        <strong>Importante</strong>
        <ul>
          <li>La mayoría de los artículos son usados.</li>
          <li>Todas las ventas son finales.</li>
        </ul>
      </aside>

      <div class="product-detail">

        <div class="product-gallery">
          <button class="main-image" type="button">
            <img
              id="main-product-image"
              src="/${stripLeadingSlash(product.images?.[0] || '')}"
              alt="${escapeHtml(product.title)}"
            >
          </button>

          ${
            product.images && product.images.length > 1
              ? `<div class="product-gallery-thumbnails">${gallery}</div>`
              : ''
          }
        </div>

        <div class="product-information">
          <div class="product-summary">

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
              ? `<p>${product.quantityRemaining} unidades disponibles</p>`
              : ''
          }

          </div>

          <p class="lead">
            ${escapeHtml(product.description).replace(/\\n/g, '<br>')}
          </p>

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
              style="display:inline-flex;align-items:center;gap:.4rem"
              href="https://wa.me/595972588347?text=${encodeURIComponent(
                'Mirá este artículo de la venta de mudanza: ' +
                product.title +
                ' · ' +
                formatPYG(product.askingPricePYG) +
                '.'
              )}"
              target="_blank"
              rel="noreferrer"
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.6" y1="10.7" x2="15.4" y2="6.3"></line>
                <line x1="8.6" y1="13.3" x2="15.4" y2="17.7"></line>
              </svg>
              Compartir por WhatsApp
            </a>

            <a class="text-action" href="/#articulos">
              ← Volver al catálogo
            </a>
          </div>

          <p class="reservation-rule">
            Un mensaje de interés no reserva el artículo.
            Queda garantizado únicamente después de que confirmemos
            el pago correspondiente.
          </p>

          <div class="pickup-confirm final-sale-notice">
            <strong>Todas las ventas son finales.</strong>
            <span>La mayoría de los artículos son usados y se venden en el estado en que se encuentran, según las fotos y la descripción publicada. Al retirar tu compra, por favor revisá el artículo antes de llevártelo. Una vez que el artículo sale de nuestro domicilio, no aceptamos cambios, devoluciones ni reembolsos.</span>
            <span>${NO_DELIVERY_NOTICE}</span>
            ${product.saleMode === 'DELAYED' ? `<span>${DELAYED_PICKUP_NOTICE}</span>` : ''}
          </div>

        </div>
      </div>

      <section class="product-notes">

        <div>
          <span class="section-kicker">DETALLES</span>
          <h2>Lo que tenés que saber</h2>
        </div>

        <dl>
          <div>
            <dt>Item ID</dt>
            <dd>Item ${String(product.itemNumber).padStart(3, '0')}</dd>
          </div>

          ${
            conditionText
              ? `
                <div>
                  <dt>Estado</dt>
                  <dd>${escapeHtml(conditionText)}</dd>
                </div>
              `
              : ''
          }

          ${
            Number(product.itemNumber) <= 57 && product.conditionNotes
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
                <div>
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

        <div class="logistics">
          <strong>Para el retiro</strong>

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
                  <p>
                    No tiene requisitos especiales de transporte
                    o carga indicados.
                  </p>
                `
            }
          </div>

          <div>
            <span class="section-kicker">POLÍTICA GENERAL</span>

            <ul>
              <li>Retiro personal en San Lorenzo, Barrio Santo Tomás.</li>
              <li>El comprador organiza y cubre el transporte.</li>
              <li>${NO_DELIVERY_NOTICE}</li>
              <li>Antes de retirarte con los artículos, revisalos y asegurate de estar conforme. Una vez retirados del domicilio, la venta es final.</li>
            </ul>
          </div>
        </div>

      </section>
    </section>
  `;

  setupProductCartButton(product);
}


async function renderCartPage() {
  const main = document.querySelector('main');

  if (!main) {
    return;
  }

  await syncStaticCartFromServer();
  document.title = 'Carrito | Venta de Mudanza';

  const cart = getStaticCart();

  const products = cart.ids
    .map((id) => getEmbeddedProductById(id))
    .filter(Boolean);

  if (!products.length) {
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

        ${cart.expiresAt ? '<div class="cart-lease-countdown" id="cart-lease-countdown" role="status">Reserva temporal · <strong></strong></div>' : ''}

        ${cart.expiresAt ? `
          <div class="pickup-confirm" id="cart-extension" ${cart.extensionUsed ? '' : 'hidden'}>
            <strong>${cart.extensionUsed ? 'Reserva extendida' : '¿Necesitás más tiempo?'}</strong>
            <span>${cart.extensionUsed ? 'Tenés 20 minutos adicionales para terminar tu compra.' : 'Podés extender tu reserva una vez por 20 minutos para terminar de comprar.'}</span>
            ${cart.extensionUsed ? '' : '<button class="secondary-action" type="button" id="extend-cart-reservation">Necesito más tiempo (+20 min)</button>'}
          </div>
        ` : ''}

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
          La reserva inicial del carrito dura 35 minutos. Podés extenderla una vez por 20 minutos.
        </small>
      </aside>

    </div>
    </section>
  `;

  setupCartPageEvents(hasUnavailable);
  startCartCountdown(cart);
  updateStaticCartCount();
}


function startCartCountdown(cart) {
  clearInterval(startCartCountdown.timer);
  const expiresAt = cart?.expiresAt;
  if (!expiresAt) return;
  const update = async () => {
    const remaining = Number(expiresAt) - Date.now();
    const target = document.querySelector('#cart-lease-countdown strong');
    const extension = document.getElementById('cart-extension');
    if (!target) return;
    if (remaining <= 0) {
      clearInterval(startCartCountdown.timer);
      await syncStaticCartFromServer();
      await renderCartPage();
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    target.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (extension && !cart.extensionUsed && remaining <= 10 * 60 * 1000) extension.hidden = false;
  };
  void update();
  startCartCountdown.timer = setInterval(update, 1000);
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

  const extendButton = document.getElementById('extend-cart-reservation');
  if (extendButton) {
    extendButton.addEventListener('click', async function () {
      extendButton.disabled = true;
      const result = await postCartReservation('extend');
      if (!result.ok || !result.lease) {
        extendButton.disabled = false;
        showCartNotice(result.error || 'No se pudo extender la reserva.');
        return;
      }
      setStaticCartFromLease(result.lease);
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
      const added = await addStaticCartItem(product.id);
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
    const added = await addStaticCartItem(product.id);
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
        extensionUsed: false,
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
      extensionUsed: Boolean(stored.extensionUsed),
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
      extensionUsed: false,
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
    extensionUsed: Boolean(lease.extensionUsed),
    ids: Object.keys(lease.items || {}),
    quantities: lease.items || {},
  });
  clearTimeout(setStaticCartFromLease.expiryTimer);
  setStaticCartFromLease.expiryTimer = setTimeout(
    () => void syncStaticCartFromServer(),
    Math.max(0, Number(lease.expiresAt) - Date.now() + 50)
  );
}


async function syncStaticCartFromServer({ migrateLegacy = false } = {}) {
  const local = getStaticCart();
  try {
    const response = await fetch('/api/cart/reservation', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo consultar la reserva.');
    window.__checkoutRecovery = result.checkoutRecovery || null;
    if (result.checkoutRecovery) {
      localStorage.setItem('mudanza-last-order', JSON.stringify({ id: result.checkoutRecovery.orderId, access: result.checkoutRecovery.accessToken }));
      saveStaticCart({ expiresAt: null, ids: [], quantities: {} });
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
      showCartNotice('La reserva temporal venció y este artículo volvió a estar disponible.');
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
      if (current.lease) {
        setStaticCartFromLease(current.lease);
        return current.lease;
      }
    }
    if (local.ids.length) saveStaticCart({ expiresAt: null, ids: [], quantities: {} });
    return null;
  } catch (error) {
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


window.addEventListener('storage', function (event) {
  if (event.key !== STATIC_CART_KEY) return;
  void syncStaticCartFromServer();
  updateStaticCartCount();
  if ((window.location.pathname.replace(/\/+$/, '') || '/') === '/carrito') void renderCartPage();
});


function saveStaticCart(cart) {
  localStorage.setItem(
    STATIC_CART_KEY,
    JSON.stringify(cart)
  );

  updateStaticCartCount();
}


async function addStaticCartItem(productId) {
  const cart = getStaticCart();
  if (cart.ids.includes(productId)) return true;
  saveStaticCart(cart);
  try {
    const result = await postCartReservation('claim', { productId, quantity: 1 });
    if (!result.ok) throw new Error(result.error || 'No se pudo reservar el artículo.');
    setStaticCartFromLease(result.lease);
    return true;
  } catch (error) {
    showCartNotice(error instanceof Error ? error.message : 'No se pudo reservar el artículo.');
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