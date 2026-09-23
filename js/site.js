// File: js/site.js

const STATIC_CART_KEY = 'mudanza-demo-cart';

window.addEventListener('load', function () {
  updateStaticCartCount();

  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (path === '/carrito') {
    renderCartPage();
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


function getEmbeddedProductBySlug(slug) {
  const unified = Array.isArray(window.__catalogProducts)
    ? window.__catalogProducts.find((product) => product.slug === slug)
    : null;

  return unified || getEmbeddedProduct('slug', slug);
}


function getEmbeddedProductById(id) {
  const unified = Array.isArray(window.__catalogProducts)
    ? window.__catalogProducts.find((product) => product.id === id)
    : null;

  return unified || getEmbeddedProduct('id', id);
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
    product.status !== 'AVAILABLE'
      ? 'NO DISPONIBLE'
      : product.saleMode === 'DELAYED'
        ? 'RETIRO 9–12 DIC.'
        : 'DISPONIBLE AHORA';

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

  const logistics =
    product.logisticsNotes && product.logisticsNotes.length
      ? product.logisticsNotes
          .map((note) => `<li>${escapeHtml(note)}</li>`)
          .join('')
      : '<li>Retiro personal.</li>';

  main.innerHTML = `
    <nav class="breadcrumbs" aria-label="Migas de pan">
      <a href="/#articulos">← Volver al catálogo</a>
      <span>/</span>
      <span>${escapeHtml(product.category)}</span>
      <span>/</span>
      <span>${escapeHtml(product.title)}</span>
    </nav>

    <section class="product-page">
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

          <span class="condition-pill">
            ${escapeHtml(product.condition)}
          </span>

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
                    <span>Saldo al retirar</span>
                    <strong>${formatPYG(balance)}</strong>
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
                product.status !== 'AVAILABLE'
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

          <div>
            <dt>Estado</dt>
            <dd>${escapeHtml(product.condition)}</dd>
          </div>

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
            Number(product.itemNumber) <= 57 && product.knownDefects
              ? `
                <div>
                  <dt>Defectos conocidos</dt>
                  <dd>${escapeHtml(product.knownDefects)}</dd>
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

          <ul>
            ${logistics}
          </ul>

          <p>
            El comprador es responsable del transporte.
            No hacemos delivery ni envíos.
          </p>
        </div>

      </section>
    </section>
  `;

  setupProductCartButton(product);
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
    <div class="page-heading">
      <span class="section-kicker">TU SELECCIÓN</span>
      <h1>Carrito</h1>
      <p>
        Revisá cuánto pagás ahora y qué saldo queda para el retiro.
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
            <dt>Saldo futuro</dt>
            <dd>${formatPYG(totals.balance)}</dd>
          </div>
        </dl>

        ${
          totals.balance > 0
            ? `
              <p>
                El saldo futuro corresponde a los artículos con retiro
                posterior y se paga al retirar.
              </p>
            `
            : ''
        }

        <div class="pickup-confirm">
          <strong>Retiro únicamente</strong>
          <span>No ofrecemos delivery ni envíos.</span>
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
          Los artículos todavía no quedan reservados en esta etapa.
        </small>
      </aside>

    </div>
  `;

  setupCartPageEvents(hasUnavailable);
  updateStaticCartCount();
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
                <dt>Saldo al retirar</dt>
                <dd>
                  ${formatPYG(
                    (product.askingPricePYG - due) * quantity
                  )}
                </dd>
              </div>

              <div>
                <dt>Ventana de retiro</dt>
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
      button.addEventListener('click', function () {
        removeStaticCartItem(
          button.getAttribute('data-cart-remove')
        );

        renderCartPage();
      });
    });

  document
    .querySelectorAll('[data-cart-quantity]')
    .forEach((select) => {
      select.addEventListener('change', function () {
        setStaticCartQuantity(
          select.getAttribute('data-cart-quantity'),
          Number(select.value)
        );

        renderCartPage();
      });
    });

  const clearButton = document.getElementById('clear-cart');

  if (clearButton) {
    clearButton.addEventListener('click', function () {
      clearStaticCart();
      renderCartPage();
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

    actionButton.addEventListener('click', function () {
      addStaticCartItem(product.id);
      refreshCatalogButton();
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

  button.addEventListener('click', function () {
    addStaticCartItem(product.id);
    refreshButton();
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
      ids: [],
      quantities: {},
    };
  }
}


function saveStaticCart(cart) {
  localStorage.setItem(
    STATIC_CART_KEY,
    JSON.stringify(cart)
  );

  updateStaticCartCount();
}


function addStaticCartItem(productId) {
  const cart = getStaticCart();

  if (!cart.ids.includes(productId)) {
    cart.ids.push(productId);
  }

  if (!cart.quantities[productId]) {
    cart.quantities[productId] = 1;
  }

  saveStaticCart(cart);
}


function removeStaticCartItem(productId) {
  const cart = getStaticCart();

  cart.ids = cart.ids.filter(
    (id) => id !== productId
  );

  delete cart.quantities[productId];

  saveStaticCart(cart);
}


function clearStaticCart() {
  saveStaticCart({
    ids: [],
    quantities: {},
  });
}


function setStaticCartQuantity(productId, quantity) {
  const cart = getStaticCart();
  const product = getEmbeddedProductById(productId);

  if (!product) {
    return;
  }

  const maxQuantity = Math.max(
    1,
    Number(product.quantityRemaining || 1)
  );

  cart.quantities[productId] = Math.min(
    maxQuantity,
    Math.max(1, Math.floor(quantity))
  );

  saveStaticCart(cart);
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

  return `Ventana del ${startDay}–${endDay} de ${month}`;
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