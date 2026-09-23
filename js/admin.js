const ADMIN_SESSION_KEY = 'mudanza-admin-token';

const ADMIN_STATE = {
  token: '',
  activeTab: 'overview',
  orders: [],
  inventory: [],
  batches: [],
  stats: {},
  inventorySearch: '',
  inventoryBatch: 'ALL',
  inventoryStatus: 'ALL',
  reviewSearch: '',
  pricingSearch: '',
};

window.addEventListener('load', function () {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (path !== '/admin') {
    return;
  }

  renderAdmin();
});


function renderAdmin() {
  document.title =
    'Panel vendedor | Venta de Mudanza';

  const token =
    sessionStorage.getItem(
      ADMIN_SESSION_KEY
    );

  if (!token) {
    renderAdminLogin();
    return;
  }

  ADMIN_STATE.token = token;

  loadAdminDashboard();
}


function renderAdminLogin() {
  const main =
    document.querySelector('main');

  main.innerHTML = `
    <section class="checkout-shell">
      <div class="page-heading">
        <span class="section-kicker">
          ADMINISTRACIÓN
        </span>

        <h1>
          Acceso vendedor
        </h1>

        <p>
          Ingresá tu clave privada.
        </p>
      </div>

      <form
        id="admin-login"
        class="checkout-card"
        style="max-width:520px"
      >
        <label>
          <span>
            Clave
          </span>

          <input
            type="password"
            name="token"
            required
            autocomplete="current-password"
          >
        </label>

        <p
          id="admin-login-error"
          class="form-error"
          hidden
        ></p>

        <button
          class="primary-action"
          type="submit"
        >
          Entrar
        </button>
      </form>
    </section>
  `;

  document
    .getElementById('admin-login')
    .addEventListener(
      'submit',
      async function (event) {
        event.preventDefault();

        const data =
          new FormData(
            event.currentTarget
          );

        const token =
          String(
            data.get('token') || ''
          );

        const errorBox =
          document.getElementById(
            'admin-login-error'
          );

        try {
          await fetchAdminOrders(token);

          sessionStorage.setItem(
            ADMIN_SESSION_KEY,
            token
          );

          ADMIN_STATE.token =
            token;

          await loadAdminDashboard();
        } catch (error) {
          errorBox.textContent =
            error instanceof Error
              ? error.message
              : 'No se pudo ingresar.';

          errorBox.hidden = false;
        }
      }
    );
}


async function adminFetch(
  url,
  options = {}
) {
  const headers =
    new Headers(
      options.headers || {}
    );

  headers.set(
    'x-admin-token',
    ADMIN_STATE.token
  );

  const response =
    await fetch(
      url,
      {
        ...options,
        headers,
        cache:
          options.cache ||
          'no-store',
      }
    );

  const contentType =
    response.headers.get(
      'content-type'
    ) || '';

  if (
    !contentType.includes(
      'application/json'
    )
  ) {
    if (!response.ok) {
      throw new Error(
        `El servidor devolvió ${response.status}.`
      );
    }

    return response;
  }

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
      'No se pudo completar la operación.'
    );
  }

  return data;
}


async function fetchAdminOrders(
  token = ADMIN_STATE.token
) {
  const response =
    await fetch(
      '/api/admin/orders',
      {
        headers: {
          'x-admin-token':
            token,
        },

        cache:
          'no-store',
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
      'No se pudieron cargar los pedidos.'
    );
  }

  return data.orders || [];
}


async function fetchLegacyInventory() {
  return adminFetch(
    '/api/admin/legacy-inventory'
  );
}


async function loadAdminDashboard() {
  const main =
    document.querySelector('main');

  main.innerHTML = `
    <section class="empty-cart">
      <span>
        Administración
      </span>

      <h1>
        Cargando panel vendedor…
      </h1>
    </section>
  `;

  try {
    const [
      orders,
      inventoryData,
    ] =
      await Promise.all([
        fetchAdminOrders(),
        fetchLegacyInventory(),
      ]);

    ADMIN_STATE.orders =
      orders;

    ADMIN_STATE.inventory =
      inventoryData.products || [];

    ADMIN_STATE.batches =
      inventoryData.batches || [];

    ADMIN_STATE.stats =
      buildAdminStats(
        ADMIN_STATE.orders,
        ADMIN_STATE.inventory
      );

    renderAdminShell();
  } catch (error) {
    if (
      error instanceof Error &&
      /no autorizado/i.test(
        error.message
      )
    ) {
      sessionStorage.removeItem(
        ADMIN_SESSION_KEY
      );

      ADMIN_STATE.token = '';

      renderAdminLogin();

      return;
    }

    main.innerHTML = `
      <section class="checkout-shell">
        <div class="admin-error-card">
          <span class="section-kicker">
            ADMINISTRACIÓN
          </span>

          <h1>
            No pudimos cargar el panel.
          </h1>

          <p>
            ${adminEscape(
              error instanceof Error
                ? error.message
                : 'Intentá nuevamente.'
            )}
          </p>

          <button
            id="admin-retry"
            class="primary-action"
            type="button"
          >
            Reintentar
          </button>
        </div>
      </section>
    `;

    document
      .getElementById(
        'admin-retry'
      )
      ?.addEventListener(
        'click',
        () => {
          loadAdminDashboard();
        }
      );
  }
}


function buildAdminStats(
  orders,
  products
) {
  const published =
    products.filter(
      (product) =>
        product.published
    ).length;

  const review =
    products.filter(
      (product) =>
        !product.published
    ).length;

  const volume2 =
    products.filter(
      (product) =>
        product.batchId ===
        'volume2-2026-09'
    ).length;

  const initial =
    products.filter(
      (product) =>
        product.batchId !==
        'volume2-2026-09'
    ).length;

  const awaitingPayment =
    orders.filter(
      (order) =>
        [
          'AWAITING_INITIAL_PAYMENT',
          'RECEIPT_RECEIVED',
          'VERIFYING_PAYMENT',
        ].includes(
          order.status
        )
    ).length;

  const confirmed =
    orders.filter(
      (order) =>
        [
          'PAYMENT_CONFIRMED',
          'DEPOSIT_CONFIRMED',
          'PAID_IN_FULL',
          'READY_TO_SCHEDULE',
          'PICKUP_SCHEDULED',
          'PICKED_UP',
        ].includes(
          order.status
        )
    ).length;

  return {
    totalProducts:
      products.length,

    published,

    review,

    volume2,

    initial,

    orderCount:
      orders.length,

    awaitingPayment,

    confirmed,
  };
}


function renderAdminShell() {
  injectAdminStyles();

  const main =
    document.querySelector('main');

  main.innerHTML = `
    <section class="admin-shell-v2">
      <header class="admin-topbar">
        <div>
          <span class="section-kicker">
            PANEL DEL PROPIETARIO
          </span>

          <h1>
            Venta de mudanza
          </h1>

          <p>
            Inventario, revisión, precios y pedidos en un solo lugar.
          </p>
        </div>

        <div class="admin-top-actions">
          <a
            class="secondary-action"
            href="/"
            target="_blank"
            rel="noreferrer"
          >
            Ver sitio público ↗
          </a>

          <button
            id="admin-export"
            class="secondary-action"
            type="button"
          >
            Exportar inventario JSON
          </button>

          <button
            id="admin-logout"
            class="text-action"
            type="button"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <nav
        class="admin-tabs-v2"
        aria-label="Secciones del panel"
      >
        ${adminTabButton(
          'overview',
          'Resumen'
        )}

        ${adminTabButton(
          'review',
          'Revisión',
          ADMIN_STATE.stats.review
        )}

        ${adminTabButton(
          'orders',
          'Pedidos',
          ADMIN_STATE.stats
            .awaitingPayment
        )}

        ${adminTabButton(
          'inventory',
          'Inventario',
          ADMIN_STATE.stats
            .totalProducts
        )}

        ${adminTabButton(
          'pricing',
          'Precios'
        )}

        ${adminTabButton(
          'batches',
          'Lotes'
        )}
      </nav>

      <div
        id="admin-tab-content"
      ></div>
    </section>
  `;

  document
    .querySelectorAll(
      '[data-admin-tab]'
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          function () {
            ADMIN_STATE.activeTab =
              button.getAttribute(
                'data-admin-tab'
              ) || 'overview';

            renderAdminTab();
          }
        );
      }
    );

  document
    .getElementById(
      'admin-logout'
    )
    ?.addEventListener(
      'click',
      function () {
        sessionStorage.removeItem(
          ADMIN_SESSION_KEY
        );

        ADMIN_STATE.token = '';

        renderAdminLogin();
      }
    );

  document
    .getElementById(
      'admin-export'
    )
    ?.addEventListener(
      'click',
      exportAdminInventory
    );

  renderAdminTab();
}


function adminTabButton(
  tab,
  label,
  count = null
) {
  return `
    <button
      type="button"
      data-admin-tab="${tab}"
      class="${
        ADMIN_STATE.activeTab === tab
          ? 'active'
          : ''
      }"
    >
      ${label}

      ${
        count === null
          ? ''
          : `<span>${count}</span>`
      }
    </button>
  `;
}


function renderAdminTab() {
  document
    .querySelectorAll(
      '[data-admin-tab]'
    )
    .forEach(
      (button) => {
        button.classList.toggle(
          'active',
          button.getAttribute(
            'data-admin-tab'
          ) ===
            ADMIN_STATE.activeTab
        );
      }
    );

  if (
    ADMIN_STATE.activeTab ===
    'orders'
  ) {
    renderOrdersTab();
    return;
  }

  if (
    ADMIN_STATE.activeTab ===
    'inventory'
  ) {
    renderInventoryTab();
    return;
  }

  if (
    ADMIN_STATE.activeTab ===
    'pricing'
  ) {
    renderPricingTab();
    return;
  }

  if (
    ADMIN_STATE.activeTab ===
    'review'
  ) {
    renderReviewTab();
    return;
  }

  if (
    ADMIN_STATE.activeTab ===
    'batches'
  ) {
    renderBatchesTab();
    return;
  }

  renderOverviewTab();
}


function renderOverviewTab() {
  const target =
    document.getElementById(
      'admin-tab-content'
    );

  const stats =
    ADMIN_STATE.stats;

  target.innerHTML = `
    <section class="admin-content-v2">
      <div class="stats-grid-v2">
        ${statCard(
          'Inventario recuperado',
          stats.totalProducts,
          'Registros reconstruidos desde el sistema anterior.'
        )}

        ${statCard(
          'Publicados',
          stats.published,
          'Artículos encontrados en el catálogo público actual.'
        )}

        ${statCard(
          'Pendientes de revisión',
          stats.review,
          'Registros legacy que todavía no aparecen publicados.'
        )}

        ${statCard(
          'Volumen 2',
          stats.volume2,
          'El lote 058–158 del sistema anterior.'
        )}

        ${statCard(
          'Pedidos',
          stats.orderCount,
          'Pedidos creados en el nuevo backend.'
        )}

        ${statCard(
          'Pagos a revisar',
          stats.awaitingPayment,
          'Pedidos que todavía requieren acción.'
        )}
      </div>

      <div class="admin-columns-v2">
        <section class="admin-panel-card">
          <span class="section-kicker">
            ACCIÓN PRIORITARIA
          </span>

          <h2>
            Pagos por confirmar
          </h2>

          ${renderPriorityOrders()}
        </section>

        <section class="admin-panel-card">
          <span class="section-kicker">
            INVENTARIO
          </span>

          <h2>
            Estado de recuperación
          </h2>

          <dl class="admin-summary-list">
            <div>
              <dt>
                Inventario inicial / legacy
              </dt>

              <dd>
                ${stats.initial}
              </dd>
            </div>

            <div>
              <dt>
                Volumen 2
              </dt>

              <dd>
                ${stats.volume2}
              </dd>
            </div>

            <div>
              <dt>
                Publicados actualmente
              </dt>

              <dd>
                ${stats.published}
              </dd>
            </div>

            <div>
              <dt>
                No publicados / por revisar
              </dt>

              <dd>
                ${stats.review}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            class="primary-action"
            data-go-review
          >
            Abrir cola de revisión
          </button>
        </section>
      </div>
    </section>
  `;

  target
    .querySelector(
      '[data-go-review]'
    )
    ?.addEventListener(
      'click',
      () => {
        ADMIN_STATE.activeTab =
          'review';

        renderAdminTab();
      }
    );

  target
    .querySelectorAll(
      '[data-priority-order]'
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            ADMIN_STATE.activeTab =
              'orders';

            renderAdminTab();

            setTimeout(
              () => {
                openAdminOrder(
                  button.getAttribute(
                    'data-priority-order'
                  )
                );
              },
              20
            );
          }
        );
      }
    );
}


function statCard(
  label,
  value,
  detail
) {
  return `
    <article>
      <span>
        ${adminEscape(label)}
      </span>

      <strong>
        ${Number(value || 0)}
      </strong>

      <p>
        ${adminEscape(detail)}
      </p>
    </article>
  `;
}


function renderPriorityOrders() {
  const orders =
    ADMIN_STATE.orders
      .filter(
        (order) =>
          [
            'RECEIPT_RECEIVED',
            'VERIFYING_PAYMENT',
            'AWAITING_INITIAL_PAYMENT',
          ].includes(
            order.status
          )
      )
      .slice(0, 6);

  if (!orders.length) {
    return `
      <div class="admin-empty-v2">
        No hay pagos pendientes de revisión.
      </div>
    `;
  }

  return `
    <div class="priority-order-list">
      ${orders
        .map(
          (order) => `
            <button
              type="button"
              data-priority-order="${
                adminEscape(
                  order.id
                )
              }"
            >
              <span>
                <strong>
                  ${adminEscape(
                    order.id
                  )}
                </strong>

                <small>
                  ${adminEscape(
                    order.buyer?.name ||
                    ''
                  )}
                </small>
              </span>

              <span>
                ${adminMoney(
                  order.totals
                    ?.dueNowPYG
                )}

                <small>
                  ${adminStatus(
                    order.status
                  )}
                </small>
              </span>
            </button>
          `
        )
        .join('')}
    </div>
  `;
}


function renderReviewTab() {
  const target =
    document.getElementById(
      'admin-tab-content'
    );

  const query =
    ADMIN_STATE.reviewSearch
      .trim()
      .toLowerCase();

  const products =
    ADMIN_STATE.inventory
      .filter(
        (product) =>
          !product.published
      )
      .filter(
        (product) => {
          if (!query) {
            return true;
          }

          return adminProductHaystack(
            product
          ).includes(
            query
          );
        }
      )
      .sort(
        compareItemNumbers
      );

  target.innerHTML = `
    <section class="admin-content-v2">
      <div class="admin-section-heading-v2">
        <div>
          <span class="section-kicker">
            REVISIÓN PRIVADA
          </span>

          <h2>
            Artículos pendientes
          </h2>

          <p>
            Estos registros existen en los lotes recuperados pero no se encontraron publicados en el catálogo actual.
          </p>
        </div>

        <strong>
          ${products.length}
          pendientes
        </strong>
      </div>

      <label class="admin-search-v2">
        <span>
          Buscar Item, nombre o categoría
        </span>

        <input
          id="review-search"
          type="search"
          value="${
            adminEscapeAttribute(
              ADMIN_STATE
                .reviewSearch
            )
          }"
          placeholder="Ej. Item 058, freezer o herramientas"
        >
      </label>

      ${
        products.length
          ? `
            <div class="legacy-review-list">
              ${products
                .map(
                  renderLegacyProductRow
                )
                .join('')}
            </div>
          `
          : `
            <div class="admin-empty-v2">
              No encontramos artículos pendientes con esa búsqueda.
            </div>
          `
      }
    </section>
  `;

  target
    .querySelector(
      '#review-search'
    )
    ?.addEventListener(
      'input',
      (event) => {
        ADMIN_STATE.reviewSearch =
          event.target.value;

        renderReviewTab();
      }
    );

  wireLegacyAccordions(
    target
  );
}


function renderInventoryTab() {
  const target =
    document.getElementById(
      'admin-tab-content'
    );

  const search =
    ADMIN_STATE.inventorySearch
      .trim()
      .toLowerCase();

  const products =
    ADMIN_STATE.inventory
      .filter(
        (product) => {
          if (
            ADMIN_STATE
              .inventoryBatch !==
              'ALL' &&
            product.batchId !==
              ADMIN_STATE
                .inventoryBatch
          ) {
            return false;
          }

          if (
            ADMIN_STATE
              .inventoryStatus ===
              'PUBLISHED' &&
            !product.published
          ) {
            return false;
          }

          if (
            ADMIN_STATE
              .inventoryStatus ===
              'REVIEW' &&
            product.published
          ) {
            return false;
          }

          if (
            search &&
            !adminProductHaystack(
              product
            ).includes(
              search
            )
          ) {
            return false;
          }

          return true;
        }
      )
      .sort(
        compareItemNumbers
      );

  target.innerHTML = `
    <section class="admin-content-v2">
      <div class="admin-section-heading-v2">
        <div>
          <span class="section-kicker">
            CATÁLOGO COMPLETO
          </span>

          <h2>
            Inventario
          </h2>

          <p>
            Inventario reconstruido desde los lotes anteriores y comparado contra el catálogo público actual.
          </p>
        </div>

        <strong>
          ${products.length}
          de
          ${ADMIN_STATE.inventory.length}
        </strong>
      </div>

      <div class="admin-filter-grid">
        <label>
          <span>
            Buscar
          </span>

          <input
            id="inventory-search"
            type="search"
            value="${
              adminEscapeAttribute(
                ADMIN_STATE
                  .inventorySearch
              )
            }"
            placeholder="Item, nombre o categoría"
          >
        </label>

        <label>
          <span>
            Lote
          </span>

          <select
            id="inventory-batch"
          >
            <option value="ALL">
              Todos los lotes
            </option>

            ${ADMIN_STATE.batches
              .map(
                (batch) => `
                  <option
                    value="${
                      adminEscapeAttribute(
                        batch.id
                      )
                    }"
                    ${
                      ADMIN_STATE
                        .inventoryBatch ===
                      batch.id
                        ? 'selected'
                        : ''
                    }
                  >
                    ${adminEscape(
                      batch.name
                    )}
                  </option>
                `
              )
              .join('')}
          </select>
        </label>

        <label>
          <span>
            Publicación
          </span>

          <select
            id="inventory-status"
          >
            <option
              value="ALL"
              ${
                ADMIN_STATE
                  .inventoryStatus ===
                'ALL'
                  ? 'selected'
                  : ''
              }
            >
              Todos
            </option>

            <option
              value="PUBLISHED"
              ${
                ADMIN_STATE
                  .inventoryStatus ===
                'PUBLISHED'
                  ? 'selected'
                  : ''
              }
            >
              Publicados
            </option>

            <option
              value="REVIEW"
              ${
                ADMIN_STATE
                  .inventoryStatus ===
                'REVIEW'
                  ? 'selected'
                  : ''
              }
            >
              Pendientes
            </option>
          </select>
        </label>
      </div>

      ${
        products.length
          ? `
            <div class="legacy-review-list">
              ${products
                .map(
                  renderLegacyProductRow
                )
                .join('')}
            </div>
          `
          : `
            <div class="admin-empty-v2">
              No encontramos artículos con esos filtros.
            </div>
          `
      }
    </section>
  `;

  target
    .querySelector(
      '#inventory-search'
    )
    ?.addEventListener(
      'input',
      (event) => {
        ADMIN_STATE
          .inventorySearch =
          event.target.value;

        renderInventoryTab();
      }
    );

  target
    .querySelector(
      '#inventory-batch'
    )
    ?.addEventListener(
      'change',
      (event) => {
        ADMIN_STATE
          .inventoryBatch =
          event.target.value;

        renderInventoryTab();
      }
    );

  target
    .querySelector(
      '#inventory-status'
    )
    ?.addEventListener(
      'change',
      (event) => {
        ADMIN_STATE
          .inventoryStatus =
          event.target.value;

        renderInventoryTab();
      }
    );

  wireLegacyAccordions(
    target
  );
}


function renderLegacyProductRow(
  product
) {
  const publicState =
    product.published
      ? `
        <span class="admin-pill is-published">
          Publicado
        </span>
      `
      : `
        <span class="admin-pill is-review">
          Pendiente
        </span>
      `;

  const livePrice =
    product.live
      ?.askingPricePYG != null
      ? adminMoney(
          product.live
            .askingPricePYG
        )
      : null;

  return `
    <article
      class="legacy-product-row"
      data-legacy-row="${
        adminEscapeAttribute(
          product.id
        )
      }"
    >
      <div class="legacy-product-summary">
        <span class="legacy-item-number">
          ${adminFormatItem(
            product.itemNumber
          )}
        </span>

        <div>
          ${publicState}

          <h3>
            ${adminEscape(
              product.title
            )}
          </h3>

          <p>
            ${adminEscape(
              product.category
            )}
            ·
            ${adminEscape(
              product.batchName ||
              'Registro recuperado'
            )}
          </p>
        </div>

        <div class="legacy-price-summary">
          <strong>
            ${adminMoney(
              livePrice
                ? product.live
                    .askingPricePYG
                : product
                    .askingPricePYG
            )}
          </strong>

          ${
            livePrice &&
            Number(
              product.live
                .askingPricePYG
            ) !==
              Number(
                product
                  .askingPricePYG
              )
              ? `
                <small>
                  Legacy:
                  ${adminMoney(
                    product
                      .askingPricePYG
                  )}
                </small>
              `
              : ''
          }
        </div>

        <button
          class="secondary-action"
          type="button"
          data-legacy-open="${
            adminEscapeAttribute(
              product.id
            )
          }"
          aria-expanded="false"
        >
          Ver ficha
        </button>
      </div>

      <div
        class="legacy-product-detail"
        data-legacy-detail="${
          adminEscapeAttribute(
            product.id
          )
        }"
        hidden
      ></div>
    </article>
  `;
}


function wireLegacyAccordions(
  root
) {
  root
    .querySelectorAll(
      '[data-legacy-open]'
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            const id =
              button.getAttribute(
                'data-legacy-open'
              );

            toggleLegacyProduct(
              id,
              root
            );
          }
        );
      }
    );
}


function toggleLegacyProduct(
  id,
  root
) {
  const target =
    root.querySelector(
      `[data-legacy-detail="${CSS.escape(
        id
      )}"]`
    );

  const button =
    root.querySelector(
      `[data-legacy-open="${CSS.escape(
        id
      )}"]`
    );

  if (
    !target ||
    !button
  ) {
    return;
  }

  const wasOpen =
    !target.hidden;

  root
    .querySelectorAll(
      '.legacy-product-detail'
    )
    .forEach(
      (detail) => {
        detail.hidden = true;
        detail.innerHTML = '';
      }
    );

  root
    .querySelectorAll(
      '[data-legacy-open]'
    )
    .forEach(
      (otherButton) => {
        otherButton.textContent =
          'Ver ficha';

        otherButton.setAttribute(
          'aria-expanded',
          'false'
        );
      }
    );

  if (wasOpen) {
    return;
  }

  const product =
    ADMIN_STATE.inventory.find(
      (candidate) =>
        candidate.id === id
    );

  if (!product) {
    return;
  }

  target.hidden = false;

  button.textContent =
    'Cerrar ficha';

  button.setAttribute(
    'aria-expanded',
    'true'
  );

  target.innerHTML =
    renderLegacyProductDetail(
      product
    );

  bindAdminProductEditor(
    product,
    target
  );
}


function renderLegacyProductDetail(
  product
) {
  const images =
    currentAdminImages(
      product
    );

  return `
    <section
      class="admin-product-editor"
      data-product-editor="${
        adminEscapeAttribute(
          product.id
        )
      }"
    >
      <section class="admin-photo-editor">
        <header class="admin-editor-heading">
          <div>
            <span>FOTOS</span>
            <strong>
              Administrar fotografías
            </strong>
          </div>

          <label class="secondary-action admin-upload-label">
            Agregar foto
            <input
              type="file"
              accept="image/*"
              multiple
              data-photo-add
              hidden
            >
          </label>
        </header>

        ${
          images.length
            ? `
              <div class="admin-photo-grid-v2">
                ${images
                  .map(
                    (image, index) => `
                      <article>
                        <img
                          src="${
                            adminEscapeAttribute(
                              image
                            )
                          }"
                          alt=""
                        >

                        ${
                          index === 0
                            ? `
                              <b>
                                FOTO PRINCIPAL
                              </b>
                            `
                            : ''
                        }

                        <div>
                          ${
                            index === 0
                              ? ''
                              : `
                                <button
                                  type="button"
                                  data-photo-primary="${
                                    adminEscapeAttribute(
                                      image
                                    )
                                  }"
                                >
                                  Hacer principal
                                </button>
                              `
                          }

                          <button
                            type="button"
                            data-photo-replace="${
                              adminEscapeAttribute(
                                image
                              )
                            }"
                          >
                            Reemplazar
                          </button>

                          <button
                            type="button"
                            data-photo-delete="${
                              adminEscapeAttribute(
                                image
                              )
                            }"
                          >
                            Eliminar
                          </button>
                        </div>
                      </article>
                    `
                  )
                  .join('')}
              </div>
            `
            : `
              <div class="admin-no-photo-v2">
                <strong>
                  Todavía no hay una imagen web disponible.
                </strong>

                ${
                  product.photoFiles?.length
                    ? `
                      <p>
                        Archivos del sistema anterior:
                      </p>

                      <small>
                        ${product.photoFiles
                          .map(adminEscape)
                          .join(' · ')}
                      </small>
                    `
                    : ''
                }
              </div>
            `
        }
      </section>

      <div class="admin-product-editor-columns">
        <section class="admin-data-editor public-data-editor">
          <header class="admin-editor-heading">
            <div>
              <span>
                INFORMACIÓN PÚBLICA
              </span>

              <strong>
                Lo que ve el comprador
              </strong>
            </div>

            <button
              type="button"
              class="secondary-action"
              data-edit-public
            >
              Editar pública
            </button>
          </header>

          <div data-public-view>
            ${renderPublicAdminView(
              product
            )}
          </div>

          <form
            data-public-form
            hidden
          >
            ${renderPublicAdminForm(
              product
            )}

            <div class="admin-form-actions">
              <button
                class="primary-action"
                type="submit"
              >
                Guardar pública
              </button>

              <button
                class="secondary-action"
                type="button"
                data-cancel-public
              >
                Cancelar
              </button>
            </div>
          </form>
        </section>

        <section class="admin-data-editor internal-data-editor">
          <header class="admin-editor-heading">
            <div>
              <span>
                SOLO INTERNO
              </span>

              <strong>
                Datos privados del vendedor
              </strong>
            </div>

            <button
              type="button"
              class="secondary-action"
              data-edit-internal
            >
              Editar interno
            </button>
          </header>

          <div data-internal-view>
            ${renderInternalAdminView(
              product
            )}
          </div>

          <form
            data-internal-form
            hidden
          >
            ${renderInternalAdminForm(
              product
            )}

            <div class="admin-form-actions">
              <button
                class="primary-action"
                type="submit"
              >
                Guardar interno
              </button>

              <button
                class="secondary-action"
                type="button"
                data-cancel-internal
              >
                Cancelar
              </button>
            </div>
          </form>
        </section>
      </div>

      <p
        class="form-error"
        data-product-editor-error
        hidden
      ></p>
    </section>
  `;
}


function renderPublicAdminView(
  product
) {
  return `
    <dl class="legacy-field-list">
      ${legacyField(
        'Nombre',
        product.title
      )}

      ${legacyField(
        'Categoría',
        product.category
      )}

      ${legacyField(
        'Precio',
        adminMoney(
          product.askingPricePYG
        )
      )}

      ${legacyField(
        'Descripción',
        product.description
      )}

      ${legacyField(
        'Condición',
        product.condition
      )}

      ${legacyField(
        'Observaciones',
        product.conditionNotes
      )}

      ${legacyField(
        'Defectos conocidos',
        product.knownDefects
      )}

      ${legacyField(
        'Incluye',
        product.includedAccessories?.length
          ? product.includedAccessories.join(' · ')
          : 'Sin accesorios indicados'
      )}

      ${legacyField(
        'Modalidad',
        product.saleMode === 'DELAYED'
          ? 'Retiro posterior'
          : 'Disponible ahora'
      )}

      ${legacyField(
        'Cantidad',
        String(
          product.quantityTotal || 1
        )
      )}
    </dl>
  `;
}


function renderInternalAdminView(
  product
) {
  const range =
    product.marketLowPYG != null &&
    product.marketHighPYG != null
      ? `${adminMoney(
          product.marketLowPYG
        )}–${adminMoney(
          product.marketHighPYG
        )}`
      : 'Sin rango';

  return `
    <dl class="legacy-field-list">
      ${legacyField(
        'Rango de mercado',
        range
      )}

      ${legacyField(
        'Estimación central',
        product.marketEstimatePYG != null
          ? adminMoney(
              product.marketEstimatePYG
            )
          : 'Sin estimación'
      )}

      ${legacyField(
        'Venta rápida',
        product.recommendedFastSalePricePYG != null
          ? adminMoney(
              product.recommendedFastSalePricePYG
            )
          : 'Sin recomendación'
      )}

      ${legacyField(
        'Piso privado',
        product.adminPriceFloorPYG != null
          ? adminMoney(
              product.adminPriceFloorPYG
            )
          : 'Sin mínimo'
      )}

      ${legacyField(
        'Confianza',
        product.pricingConfidence ||
        'Sin asignar'
      )}

      ${legacyField(
        'Pregunta / revisión',
        product.reviewFlag ||
        'Ninguna'
      )}

      ${legacyField(
        'Investigación',
        product.pricingResearch ||
        'Sin investigación'
      )}

      ${legacyField(
        'Notas internas',
        product.internalNotes ||
        'Sin notas internas'
      )}
    </dl>
  `;
}


function renderPublicAdminForm(
  product
) {
  return `
    ${adminEditorInput(
      'Nombre',
      'title',
      product.title
    )}

    ${adminEditorInput(
      'Categoría',
      'category',
      product.category
    )}

    ${adminEditorInput(
      'Precio pedido (Gs.)',
      'askingPricePYG',
      product.askingPricePYG,
      'number'
    )}

    ${adminEditorTextarea(
      'Descripción pública',
      'description',
      product.description
    )}

    ${adminEditorInput(
      'Condición',
      'condition',
      product.condition
    )}

    ${adminEditorTextarea(
      'Observaciones',
      'conditionNotes',
      product.conditionNotes
    )}

    ${adminEditorTextarea(
      'Defectos conocidos',
      'knownDefects',
      product.knownDefects
    )}

    ${adminEditorTextarea(
      'Incluye — una línea por elemento',
      'includedAccessories',
      (product.includedAccessories || []).join('\n')
    )}

    <label>
      <span>
        Modalidad
      </span>

      <select name="saleMode">
        <option
          value="IMMEDIATE"
          ${
            product.saleMode === 'IMMEDIATE'
              ? 'selected'
              : ''
          }
        >
          Disponible ahora
        </option>

        <option
          value="DELAYED"
          ${
            product.saleMode === 'DELAYED'
              ? 'selected'
              : ''
          }
        >
          Retiro posterior
        </option>
      </select>
    </label>

    ${adminEditorInput(
      'Seña (%)',
      'depositPercent',
      product.depositPercent ??
      (
        product.saleMode === 'DELAYED'
          ? 25
          : 100
      ),
      'number'
    )}

    ${adminEditorInput(
      'Fecha mínima de retiro',
      'pickupAvailableDate',
      product.pickupAvailableDate || '',
      'date'
    )}

    ${adminEditorInput(
      'Inicio de ventana',
      'pickupWindowStart',
      product.pickupWindowStart || '',
      'date'
    )}

    ${adminEditorInput(
      'Fin de ventana',
      'pickupWindowEnd',
      product.pickupWindowEnd || '',
      'date'
    )}

    ${adminEditorInput(
      'Cantidad total',
      'quantityTotal',
      product.quantityTotal || 1,
      'number'
    )}

    <label class="admin-editor-checkbox">
      <input
        type="checkbox"
        name="requiresVehicle"
        ${
          product.requiresVehicle
            ? 'checked'
            : ''
        }
      >
      <span>Requiere vehículo</span>
    </label>

    <label class="admin-editor-checkbox">
      <input
        type="checkbox"
        name="requiresLoadingHelp"
        ${
          product.requiresLoadingHelp
            ? 'checked'
            : ''
        }
      >
      <span>
        Requiere ayuda para cargar
      </span>
    </label>
  `;
}


function renderInternalAdminForm(
  product
) {
  return `
    ${adminEditorInput(
      'Mercado bajo (Gs.)',
      'marketLowPYG',
      product.marketLowPYG ?? '',
      'number'
    )}

    ${adminEditorInput(
      'Mercado alto (Gs.)',
      'marketHighPYG',
      product.marketHighPYG ?? '',
      'number'
    )}

    ${adminEditorInput(
      'Estimación central (Gs.)',
      'marketEstimatePYG',
      product.marketEstimatePYG ?? '',
      'number'
    )}

    ${adminEditorInput(
      'Venta rápida (Gs.)',
      'recommendedFastSalePricePYG',
      product.recommendedFastSalePricePYG ?? '',
      'number'
    )}

    ${adminEditorInput(
      'Piso privado (Gs.)',
      'adminPriceFloorPYG',
      product.adminPriceFloorPYG ?? '',
      'number'
    )}

    ${adminEditorInput(
      'Confianza',
      'pricingConfidence',
      product.pricingConfidence || ''
    )}

    ${adminEditorTextarea(
      'Pregunta / revisión pendiente',
      'reviewFlag',
      product.reviewFlag || ''
    )}

    ${adminEditorTextarea(
      'Investigación y fuentes',
      'pricingResearch',
      product.pricingResearch || ''
    )}

    ${adminEditorTextarea(
      'Notas internas',
      'internalNotes',
      product.internalNotes || ''
    )}
  `;
}


function adminEditorInput(
  label,
  name,
  value,
  type = 'text'
) {
  return `
    <label>
      <span>
        ${adminEscape(label)}
      </span>

      <input
        type="${type}"
        name="${name}"
        value="${
          adminEscapeAttribute(
            value ?? ''
          )
        }"
      >
    </label>
  `;
}


function adminEditorTextarea(
  label,
  name,
  value
) {
  return `
    <label>
      <span>
        ${adminEscape(label)}
      </span>

      <textarea
        name="${name}"
        rows="4"
      >${adminEscape(
        value ?? ''
      )}</textarea>
    </label>
  `;
}


function bindAdminProductEditor(
  product,
  root
) {
  const editor =
    root.querySelector(
      '[data-product-editor]'
    );

  if (!editor) {
    return;
  }

  const publicView =
    editor.querySelector(
      '[data-public-view]'
    );

  const publicForm =
    editor.querySelector(
      '[data-public-form]'
    );

  const internalView =
    editor.querySelector(
      '[data-internal-view]'
    );

  const internalForm =
    editor.querySelector(
      '[data-internal-form]'
    );

  editor
    .querySelector(
      '[data-edit-public]'
    )
    ?.addEventListener(
      'click',
      () => {
        publicView.hidden = true;
        publicForm.hidden = false;
      }
    );

  editor
    .querySelector(
      '[data-cancel-public]'
    )
    ?.addEventListener(
      'click',
      () => {
        publicForm.hidden = true;
        publicView.hidden = false;
      }
    );

  editor
    .querySelector(
      '[data-edit-internal]'
    )
    ?.addEventListener(
      'click',
      () => {
        internalView.hidden = true;
        internalForm.hidden = false;
      }
    );

  editor
    .querySelector(
      '[data-cancel-internal]'
    )
    ?.addEventListener(
      'click',
      () => {
        internalForm.hidden = true;
        internalView.hidden = false;
      }
    );

  publicForm
    ?.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();

        const data =
          new FormData(publicForm);

        try {
          await saveAdminProduct(
            product.id,
            {
              publicFields: {
                title:
                  adminFormText(
                    data,
                    'title'
                  ),

                category:
                  adminFormText(
                    data,
                    'category'
                  ),

                description:
                  adminFormText(
                    data,
                    'description'
                  ),

                condition:
                  adminFormText(
                    data,
                    'condition'
                  ),

                conditionNotes:
                  adminFormText(
                    data,
                    'conditionNotes'
                  ),

                knownDefects:
                  adminFormText(
                    data,
                    'knownDefects'
                  ),

                includedAccessories:
                  adminFormLines(
                    data,
                    'includedAccessories'
                  ),

                askingPricePYG:
                  adminFormNumber(
                    data,
                    'askingPricePYG'
                  ),

                saleMode:
                  adminFormText(
                    data,
                    'saleMode'
                  ),

                depositPercent:
                  adminFormNumber(
                    data,
                    'depositPercent'
                  ),

                pickupAvailableDate:
                  adminFormNullableText(
                    data,
                    'pickupAvailableDate'
                  ),

                pickupWindowStart:
                  adminFormNullableText(
                    data,
                    'pickupWindowStart'
                  ),

                pickupWindowEnd:
                  adminFormNullableText(
                    data,
                    'pickupWindowEnd'
                  ),

                quantityTotal:
                  Math.max(
                    1,
                    adminFormNumber(
                      data,
                      'quantityTotal'
                    )
                  ),

                requiresVehicle:
                  data.has(
                    'requiresVehicle'
                  ),

                requiresLoadingHelp:
                  data.has(
                    'requiresLoadingHelp'
                  ),
              },
            }
          );

          await refreshAdminProduct(
            product.id
          );
        } catch (error) {
          showProductEditorError(
            editor,
            error
          );
        }
      }
    );

  internalForm
    ?.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();

        const data =
          new FormData(
            internalForm
          );

        try {
          await saveAdminProduct(
            product.id,
            {
              internalFields: {
                marketLowPYG:
                  adminFormNullableNumber(
                    data,
                    'marketLowPYG'
                  ),

                marketHighPYG:
                  adminFormNullableNumber(
                    data,
                    'marketHighPYG'
                  ),

                marketEstimatePYG:
                  adminFormNullableNumber(
                    data,
                    'marketEstimatePYG'
                  ),

                recommendedFastSalePricePYG:
                  adminFormNullableNumber(
                    data,
                    'recommendedFastSalePricePYG'
                  ),

                adminPriceFloorPYG:
                  adminFormNullableNumber(
                    data,
                    'adminPriceFloorPYG'
                  ),

                pricingConfidence:
                  adminFormNullableText(
                    data,
                    'pricingConfidence'
                  ),

                reviewFlag:
                  adminFormNullableText(
                    data,
                    'reviewFlag'
                  ),

                pricingResearch:
                  adminFormNullableText(
                    data,
                    'pricingResearch'
                  ),

                internalNotes:
                  adminFormNullableText(
                    data,
                    'internalNotes'
                  ),
              },
            }
          );

          await refreshAdminProduct(
            product.id
          );
        } catch (error) {
          showProductEditorError(
            editor,
            error
          );
        }
      }
    );

  editor
    .querySelector(
      '[data-photo-add]'
    )
    ?.addEventListener(
      'change',
      async (event) => {
        try {
          const files =
            Array.from(
              event.target.files || []
            );

          for (const file of files) {
            await uploadAdminProductPhoto(
              product,
              file,
              'add'
            );
          }

          await refreshAdminProduct(
            product.id
          );
        } catch (error) {
          showProductEditorError(
            editor,
            error
          );
        }
      }
    );

  editor
    .querySelectorAll(
      '[data-photo-primary]'
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          async () => {
            try {
              await adminPhotoAction(
                product,
                {
                  action: 'primary',
                  target:
                    button.getAttribute(
                      'data-photo-primary'
                    ),
                }
              );

              await refreshAdminProduct(
                product.id
              );
            } catch (error) {
              showProductEditorError(
                editor,
                error
              );
            }
          }
        );
      }
    );

  editor
    .querySelectorAll(
      '[data-photo-delete]'
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          async () => {
            const target =
              button.getAttribute(
                'data-photo-delete'
              );

            if (
              !window.confirm(
                '¿Eliminar esta foto del artículo?'
              )
            ) {
              return;
            }

            try {
              await adminPhotoAction(
                product,
                {
                  action: 'delete',
                  target,
                }
              );

              await refreshAdminProduct(
                product.id
              );
            } catch (error) {
              showProductEditorError(
                editor,
                error
              );
            }
          }
        );
      }
    );

  editor
    .querySelectorAll(
      '[data-photo-replace]'
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            const input =
              document.createElement(
                'input'
              );

            input.type = 'file';
            input.accept = 'image/*';

            input.addEventListener(
              'change',
              async () => {
                const file =
                  input.files?.[0];

                if (!file) {
                  return;
                }

                try {
                  await uploadAdminProductPhoto(
                    product,
                    file,
                    'replace',
                    button.getAttribute(
                      'data-photo-replace'
                    )
                  );

                  await refreshAdminProduct(
                    product.id
                  );
                } catch (error) {
                  showProductEditorError(
                    editor,
                    error
                  );
                }
              }
            );

            input.click();
          }
        );
      }
    );
}


function currentAdminImages(
  product
) {
  if (
    Array.isArray(product.images)
  ) {
    return product.images;
  }

  if (
    Array.isArray(
      product.live?.images
    )
  ) {
    return product.live.images;
  }

  return [];
}


async function saveAdminProduct(
  productId,
  fields
) {
  return adminFetch(
    '/.netlify/functions/admin-product',
    {
      method: 'POST',

      headers: {
        'content-type':
          'application/json',
      },

      body:
        JSON.stringify({
          productId,
          ...fields,
        }),
    }
  );
}


async function adminPhotoAction(
  product,
  payload
) {
  return adminFetch(
    '/.netlify/functions/admin-product-photo',
    {
      method: 'POST',

      headers: {
        'content-type':
          'application/json',
      },

      body:
        JSON.stringify({
          productId:
            product.id,

          currentImages:
            currentAdminImages(
              product
            ),

          ...payload,
        }),
    }
  );
}


async function uploadAdminProductPhoto(
  product,
  file,
  action,
  target = null
) {
  const prepared =
    await prepareAdminImage(
      file
    );

  return adminPhotoAction(
    product,
    {
      action,
      target,

      fileName:
        file.name,

      contentType:
        prepared.contentType,

      base64:
        prepared.base64,
    }
  );
}


async function prepareAdminImage(
  file
) {
  const image =
    await adminLoadImage(
      file
    );

  const maxSide = 1800;

  const scale =
    Math.min(
      1,
      maxSide /
      Math.max(
        image.naturalWidth,
        image.naturalHeight
      )
    );

  const width =
    Math.max(
      1,
      Math.round(
        image.naturalWidth *
        scale
      )
    );

  const height =
    Math.max(
      1,
      Math.round(
        image.naturalHeight *
        scale
      )
    );

  const canvas =
    document.createElement(
      'canvas'
    );

  canvas.width = width;
  canvas.height = height;

  const context =
    canvas.getContext('2d');

  context.drawImage(
    image,
    0,
    0,
    width,
    height
  );

  const blob =
    await new Promise(
      (resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) {
              resolve(result);
            } else {
              reject(
                new Error(
                  'No se pudo preparar la foto.'
                )
              );
            }
          },
          'image/jpeg',
          0.84
        );
      }
    );

  const dataUrl =
    await adminBlobToDataUrl(
      blob
    );

  return {
    contentType:
      'image/jpeg',

    base64:
      dataUrl.split(',')[1],
  };
}


function adminLoadImage(
  file
) {
  return new Promise(
    (resolve, reject) => {
      const url =
        URL.createObjectURL(
          file
        );

      const image =
        new Image();

      image.onload =
        () => {
          URL.revokeObjectURL(
            url
          );

          resolve(image);
        };

      image.onerror =
        () => {
          URL.revokeObjectURL(
            url
          );

          reject(
            new Error(
              'No se pudo leer la foto.'
            )
          );
        };

      image.src = url;
    }
  );
}


function adminBlobToDataUrl(
  blob
) {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onload =
        () =>
          resolve(
            String(
              reader.result || ''
            )
          );

      reader.onerror =
        () =>
          reject(
            new Error(
              'No se pudo procesar la foto.'
            )
          );

      reader.readAsDataURL(
        blob
      );
    }
  );
}


async function refreshAdminProduct(
  productId
) {
  const activeTab =
    ADMIN_STATE.activeTab;

  await loadAdminDashboard();

  ADMIN_STATE.activeTab =
    activeTab;

  renderAdminTab();

  window.setTimeout(
    () => {
      document
        .querySelector(
          `[data-legacy-open="${CSS.escape(
            productId
          )}"]`
        )
        ?.click();
    },
    30
  );
}


function showProductEditorError(
  editor,
  error
) {
  const box =
    editor.querySelector(
      '[data-product-editor-error]'
    );

  if (!box) {
    return;
  }

  box.textContent =
    error instanceof Error
      ? error.message
      : 'No se pudo guardar.';

  box.hidden = false;
}


function adminFormText(
  data,
  key
) {
  return String(
    data.get(key) || ''
  ).trim();
}


function adminFormNullableText(
  data,
  key
) {
  const value =
    adminFormText(
      data,
      key
    );

  return value || null;
}


function adminFormNumber(
  data,
  key
) {
  const value =
    Number(
      data.get(key) || 0
    );

  return Number.isFinite(value)
    ? Math.max(
        0,
        Math.round(value)
      )
    : 0;
}


function adminFormNullableNumber(
  data,
  key
) {
  const raw =
    String(
      data.get(key) || ''
    ).trim();

  if (!raw) {
    return null;
  }

  const value =
    Number(raw);

  return Number.isFinite(value)
    ? Math.max(
        0,
        Math.round(value)
      )
    : null;
}


function adminFormLines(
  data,
  key
) {
  return String(
    data.get(key) || ''
  )
    .split(/\r?\n/)
    .map(
      (line) =>
        line.trim()
    )
    .filter(Boolean);
}




function legacyField(
  label,
  value
) {
  return `
    <div>
      <dt>
        ${adminEscape(
          label
        )}
      </dt>

      <dd>
        ${adminEscape(
          value ?? ''
        )}
      </dd>
    </div>
  `;
}


function renderPricingTab() {
  const target =
    document.getElementById(
      'admin-tab-content'
    );

  const query =
    ADMIN_STATE.pricingSearch
      .trim()
      .toLowerCase();

  const products =
    ADMIN_STATE.inventory
      .filter(
        (product) => {
          if (!query) {
            return true;
          }

          return adminProductHaystack(
            product
          ).includes(
            query
          );
        }
      )
      .sort(
        compareItemNumbers
      );

  target.innerHTML = `
    <section class="admin-content-v2">
      <div class="admin-section-heading-v2">
        <div>
          <span class="section-kicker">
            PRECIOS
          </span>

          <h2>
            Investigación y referencias
          </h2>

          <p>
            Conserva los precios y notas de investigación que estaban en el sistema anterior.
          </p>
        </div>

        <strong>
          ${products.length}
          artículos
        </strong>
      </div>

      <label class="admin-search-v2">
        <span>
          Buscar Item, nombre o categoría
        </span>

        <input
          id="pricing-search"
          type="search"
          value="${
            adminEscapeAttribute(
              ADMIN_STATE
                .pricingSearch
            )
          }"
          placeholder="Ej. Item 101, Samsung o cocina"
        >
      </label>

      <div class="pricing-table-wrap">
        <table class="pricing-table-v2">
          <thead>
            <tr>
              <th>
                Item
              </th>

              <th>
                Artículo
              </th>

              <th>
                Pedido
              </th>

              <th>
                Mercado
              </th>

              <th>
                Venta rápida
              </th>

              <th>
                Piso
              </th>

              <th>
                Confianza
              </th>
            </tr>
          </thead>

          <tbody>
            ${products
              .map(
                (product) => `
                  <tr>
                    <td>
                      ${adminFormatItem(
                        product.itemNumber
                      )}
                    </td>

                    <td>
                      <strong>
                        ${adminEscape(
                          product.title
                        )}
                      </strong>

                      <small>
                        ${adminEscape(
                          product.category
                        )}
                      </small>
                    </td>

                    <td>
                      ${adminMoney(
                        product
                          .askingPricePYG
                      )}
                    </td>

                    <td>
                      ${
                        product
                          .marketLowPYG !=
                          null &&
                        product
                          .marketHighPYG !=
                          null
                          ? `${adminMoney(
                              product
                                .marketLowPYG
                            )}–${adminMoney(
                              product
                                .marketHighPYG
                            )}`
                          : '—'
                      }
                    </td>

                    <td>
                      ${
                        product
                          .recommendedFastSalePricePYG !=
                        null
                          ? adminMoney(
                              product
                                .recommendedFastSalePricePYG
                            )
                          : '—'
                      }
                    </td>

                    <td>
                      ${
                        product
                          .adminPriceFloorPYG !=
                        null
                          ? adminMoney(
                              product
                                .adminPriceFloorPYG
                            )
                          : '—'
                      }
                    </td>

                    <td>
                      ${adminEscape(
                        product
                          .pricingConfidence ||
                        '—'
                      )}
                    </td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  target
    .querySelector(
      '#pricing-search'
    )
    ?.addEventListener(
      'input',
      (event) => {
        ADMIN_STATE.pricingSearch =
          event.target.value;

        renderPricingTab();
      }
    );
}


function renderBatchesTab() {
  const target =
    document.getElementById(
      'admin-tab-content'
    );

  target.innerHTML = `
    <section class="admin-content-v2">
      <div class="admin-section-heading-v2">
        <div>
          <span class="section-kicker">
            LOTES
          </span>

          <h2>
            Historial de carga
          </h2>

          <p>
            Los registros originales se conservan separados por lote para que Volumen 3 pueda continuar sin renumerar.
          </p>
        </div>
      </div>

      <div class="batch-grid-v2">
        ${ADMIN_STATE.batches
          .map(
            (batch) => {
              const products =
                ADMIN_STATE.inventory.filter(
                  (product) =>
                    product.batchId ===
                    batch.id
                );

              const published =
                products.filter(
                  (product) =>
                    product.published
                ).length;

              return `
                <article>
                  <span class="section-kicker">
                    LOTE RECUPERADO
                  </span>

                  <h3>
                    ${adminEscape(
                      batch.name
                    )}
                  </h3>

                  <strong>
                    ${products.length}
                    artículos
                  </strong>

                  <p>
                    ${published}
                    publicados ·
                    ${
                      products.length -
                      published
                    }
                    pendientes
                  </p>

                  ${
                    batch.id ===
                    'volume2-2026-09'
                      ? `
                        <small>
                          Item 058–158 · 101 registros protegidos por la numeración original.
                        </small>
                      `
                      : ''
                  }
                </article>
              `;
            }
          )
          .join('')}

        <article class="future-batch-card">
          <span class="section-kicker">
            PRÓXIMO LOTE
          </span>

          <h3>
            Volumen 3
          </h3>

          <strong>
            Comienza después del último Item recuperado
          </strong>

          <p>
            Este será el lote para la próxima carga masiva de fotos y borradores asistidos por IA.
          </p>
        </article>
      </div>
    </section>
  `;
}


function renderOrdersTab() {
  const target =
    document.getElementById(
      'admin-tab-content'
    );

  const rows =
    ADMIN_STATE.orders.length
      ? ADMIN_STATE.orders
          .map(
            (order) => `
              <article
                class="admin-order-row-v2"
                data-order-row="${
                  adminEscapeAttribute(
                    order.id
                  )
                }"
              >
                <div>
                  <strong>
                    ${adminEscape(
                      order.id
                    )}
                  </strong>

                  <span>
                    ${adminEscape(
                      order.buyer
                        ?.name ||
                      ''
                    )}
                  </span>

                  <small>
                    ${new Date(
                      order.createdAt
                    ).toLocaleString(
                      'es-PY'
                    )}
                  </small>
                </div>

                <div>
                  <strong>
                    ${adminMoney(
                      order.totals
                        ?.dueNowPYG
                    )}
                  </strong>

                  <span>
                    ${adminStatus(
                      order.status
                    )}
                  </span>
                </div>

                <button
                  class="secondary-action"
                  type="button"
                  data-admin-open="${
                    adminEscapeAttribute(
                      order.id
                    )
                  }"
                  aria-expanded="false"
                >
                  Abrir pedido
                </button>

                <div
                  class="admin-inline-detail"
                  data-admin-detail="${
                    adminEscapeAttribute(
                      order.id
                    )
                  }"
                  hidden
                ></div>
              </article>
            `
          )
          .join('')
      : `
        <div class="admin-empty-v2">
          Todavía no hay pedidos en este entorno.
        </div>
      `;

  target.innerHTML = `
    <section class="admin-content-v2">
      <div class="admin-section-heading-v2">
        <div>
          <span class="section-kicker">
            BANDEJA DE PEDIDOS
          </span>

          <h2>
            Reservas y ventas
          </h2>

          <p>
            Comprobantes, pagos confirmados y seguimiento del comprador.
          </p>
        </div>

        <strong>
          ${ADMIN_STATE.orders.length}
          pedido${
            ADMIN_STATE.orders.length ===
            1
              ? ''
              : 's'
          }
        </strong>
      </div>

      <div class="admin-order-list-v2">
        ${rows}
      </div>
    </section>
  `;

  target
    .querySelectorAll(
      '[data-admin-open]'
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          function () {
            openAdminOrder(
              button.getAttribute(
                'data-admin-open'
              )
            );
          }
        );
      }
    );
}


async function openAdminOrder(
  orderId
) {
  const root =
    document.getElementById(
      'admin-tab-content'
    );

  const target =
    root?.querySelector(
      `[data-admin-detail="${CSS.escape(
        orderId
      )}"]`
    );

  const button =
    root?.querySelector(
      `[data-admin-open="${CSS.escape(
        orderId
      )}"]`
    );

  if (
    !target ||
    !button
  ) {
    return;
  }

  const alreadyOpen =
    !target.hidden;

  root
    .querySelectorAll(
      '.admin-inline-detail'
    )
    .forEach(
      (detail) => {
        detail.hidden = true;
        detail.innerHTML = '';
      }
    );

  root
    .querySelectorAll(
      '[data-admin-open]'
    )
    .forEach(
      (openButton) => {
        openButton.setAttribute(
          'aria-expanded',
          'false'
        );

        openButton.textContent =
          'Abrir pedido';
      }
    );

  if (alreadyOpen) {
    return;
  }

  target.hidden = false;

  target.innerHTML = `
    <p>
      Cargando pedido…
    </p>
  `;

  button.setAttribute(
    'aria-expanded',
    'true'
  );

  button.textContent =
    'Cerrar pedido';

  try {
    const data =
      await adminFetch(
        `/api/admin/order?id=${encodeURIComponent(
          orderId
        )}`
      );

    renderAdminOrderDetail(
      data.order,
      target
    );
  } catch (error) {
    target.innerHTML = `
      <p class="form-error">
        ${adminEscape(
          error instanceof Error
            ? error.message
            : 'No se pudo abrir el pedido.'
        )}
      </p>
    `;
  }
}


function renderAdminOrderDetail(
  order,
  target
) {
  const items =
    (order.items || [])
      .map(
        (item) => `
          <li>
            ${item.quantity}
            ×
            ${adminEscape(
              item.title
            )}
          </li>
        `
      )
      .join('');

  const canConfirm =
    [
      'RECEIPT_RECEIVED',
      'VERIFYING_PAYMENT',
    ].includes(
      order.status
    );

  target.innerHTML = `
    <section class="admin-order-detail-v2">
      <span class="section-kicker">
        PEDIDO
      </span>

      <h2>
        ${adminEscape(
          order.id
        )}
      </h2>

      <div class="order-detail-columns">
        <div>
          <p>
            <strong>
              ${adminEscape(
                order.buyer
                  ?.name ||
                ''
              )}
            </strong>

            <br>

            WhatsApp:
            ${adminEscape(
              order.buyer
                ?.phone ||
              ''
            )}
          </p>

          ${
            order.buyer
              ?.email
              ? `
                <p>
                  Email:
                  ${adminEscape(
                    order.buyer
                      .email
                  )}
                </p>
              `
              : ''
          }

          <p>
            Estado:
            <strong>
              ${adminStatus(
                order.status
              )}
            </strong>
          </p>

          <ul>
            ${items}
          </ul>
        </div>

        <div>
          <dl class="admin-summary-list">
            <div>
              <dt>
                Valor total
              </dt>

              <dd>
                ${adminMoney(
                  order.totals
                    ?.totalPYG
                )}
              </dd>
            </div>

            <div>
              <dt>
                A pagar ahora
              </dt>

              <dd>
                ${adminMoney(
                  order.totals
                    ?.dueNowPYG
                )}
              </dd>
            </div>

            <div>
              <dt>
                Saldo futuro
              </dt>

              <dd>
                ${adminMoney(
                  order.totals
                    ?.futureBalancePYG
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div class="order-detail-actions">
        ${
          order.receipt
            ? `
              <button
                class="secondary-action"
                type="button"
                data-view-receipt
              >
                Ver comprobante
              </button>
            `
            : `
              <span>
                Todavía no hay comprobante.
              </span>
            `
        }

        ${
          canConfirm
            ? `
              <button
                class="primary-action"
                type="button"
                data-confirm-payment
              >
                Confirmé que los fondos ingresaron
              </button>
            `
            : ''
        }

        <a
          class="secondary-action"
          target="_blank"
          rel="noreferrer"
          href="https://wa.me/${String(
            order.buyer
              ?.phone ||
            ''
          ).replace(/\D/g, '')}?text=${encodeURIComponent(
            `Hola ${order.buyer?.name || ''}, te escribo por tu pedido ${order.id}.`
          )}"
        >
          Escribir al comprador
        </a>
      </div>
    </section>
  `;

  target
    .querySelector(
      '[data-view-receipt]'
    )
    ?.addEventListener(
      'click',
      () => {
        viewAdminReceipt(
          order.id
        );
      }
    );

  target
    .querySelector(
      '[data-confirm-payment]'
    )
    ?.addEventListener(
      'click',
      () => {
        confirmAdminPayment(
          order.id
        );
      }
    );
}


async function viewAdminReceipt(
  orderId
) {
  const response =
    await fetch(
      `/api/admin/receipt?id=${encodeURIComponent(
        orderId
      )}`,
      {
        headers: {
          'x-admin-token':
            ADMIN_STATE.token,
        },
      }
    );

  if (!response.ok) {
    alert(
      'No se pudo abrir el comprobante.'
    );

    return;
  }

  const blob =
    await response.blob();

  const url =
    URL.createObjectURL(
      blob
    );

  window.open(
    url,
    '_blank',
    'noopener,noreferrer'
  );

  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    60000
  );
}


async function confirmAdminPayment(
  orderId
) {
  const confirmed =
    window.confirm(
      '¿Confirmás que verificaste personalmente que los fondos ingresaron a tu cuenta bancaria?'
    );

  if (!confirmed) {
    return;
  }

  try {
    await adminFetch(
      '/api/admin/confirm-payment',
      {
        method:
          'POST',

        headers: {
          'content-type':
            'application/json',
        },

        body:
          JSON.stringify({
            orderId,
          }),
      }
    );

    ADMIN_STATE.orders =
      await fetchAdminOrders();

    ADMIN_STATE.stats =
      buildAdminStats(
        ADMIN_STATE.orders,
        ADMIN_STATE.inventory
      );

    renderOrdersTab();

    setTimeout(
      () => {
        openAdminOrder(
          orderId
        );
      },
      30
    );
  } catch (error) {
    alert(
      error instanceof Error
        ? error.message
        : 'No se pudo confirmar el pago.'
    );
  }
}


function exportAdminInventory() {
  const payload = {
    exportedAt:
      new Date()
        .toISOString(),

    batches:
      ADMIN_STATE.batches,

    products:
      ADMIN_STATE.inventory,
  };

  const blob =
    new Blob(
      [
        JSON.stringify(
          payload,
          null,
          2
        ),
      ],
      {
        type:
          'application/json',
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const anchor =
    document.createElement(
      'a'
    );

  anchor.href =
    url;

  anchor.download =
    `venta-mudanza-inventory-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

  document.body.appendChild(
    anchor
  );

  anchor.click();

  anchor.remove();

  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    30000
  );
}


function adminProductHaystack(
  product
) {
  return [
    adminFormatItem(
      product.itemNumber
    ),
    product.title,
    product.category,
    product.description,
    product.condition,
    product.reviewFlag,
    product.pricingResearch,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}


function compareItemNumbers(
  a,
  b
) {
  return (
    Number(
      a.itemNumber ||
      999999
    ) -
    Number(
      b.itemNumber ||
      999999
    )
  );
}


function adminStatus(
  status
) {
  const labels = {
    AWAITING_INITIAL_PAYMENT:
      'Esperando transferencia',

    RECEIPT_RECEIVED:
      'Comprobante recibido',

    VERIFYING_PAYMENT:
      'Verificando pago',

    PAYMENT_CONFIRMED:
      'Pago confirmado',

    DEPOSIT_CONFIRMED:
      'Seña confirmada',

    RESERVED:
      'Reservado',

    BALANCE_DUE:
      'Saldo pendiente',

    PAID_IN_FULL:
      'Pago completo',

    READY_TO_SCHEDULE:
      'Listo para coordinar retiro',

    PICKUP_SCHEDULED:
      'Retiro programado',

    PICKED_UP:
      'Retirado',
  };

  return (
    labels[status] ||
    status ||
    ''
  );
}


function adminFormatItem(
  value
) {
  return value == null
    ? 'Sin Item'
    : `Item ${String(
        value
      ).padStart(
        3,
        '0'
      )}`;
}


function adminMoney(
  value
) {
  return (
    'Gs. ' +
    Number(
      value || 0
    ).toLocaleString(
      'es-PY'
    )
  );
}


function adminEscape(
  value
) {
  return String(
    value ?? ''
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}


function adminEscapeAttribute(
  value
) {
  return adminEscape(
    value
  );
}


function injectAdminStyles() {
  if (
    document.getElementById(
      'admin-dashboard-v2-styles'
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      'style'
    );

  style.id =
    'admin-dashboard-v2-styles';

  style.textContent = `
    .admin-shell-v2 {
      max-width: 1240px;
      margin: 0 auto;
      padding: 34px 24px 80px;
    }

    .admin-topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 28px;
      margin-bottom: 24px;
    }

    .admin-topbar h1 {
      margin: 5px 0 7px;
      font-family: Georgia, serif;
      font-size: clamp(32px, 5vw, 48px);
      font-weight: 500;
    }

    .admin-topbar p {
      color: var(--muted);
      margin: 0;
    }

    .admin-top-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
      align-items: center;
    }

    .admin-tabs-v2 {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 12px;
    }

    .admin-tabs-v2 button {
      min-height: 40px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      border-radius: 7px;
      padding: 0 14px;
      font-size: 11px;
      font-weight: 800;
    }

    .admin-tabs-v2 button.active {
      background: var(--forest);
      border-color: var(--forest);
      color: #fff;
    }

    .admin-tabs-v2 button span {
      min-width: 20px;
      height: 20px;
      display: inline-grid;
      place-items: center;
      margin-left: 6px;
      border-radius: 999px;
      background: rgba(0,0,0,.08);
      font-size: 9px;
    }

    .admin-tabs-v2 button.active span {
      background: rgba(255,255,255,.18);
    }

    .admin-content-v2 {
      padding-top: 28px;
    }

    .stats-grid-v2 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .stats-grid-v2 article,
    .admin-panel-card,
    .batch-grid-v2 article {
      background: #fffdfa;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 20px;
    }

    .stats-grid-v2 article > span {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .06em;
      font-size: 9px;
      font-weight: 800;
    }

    .stats-grid-v2 article > strong {
      display: block;
      margin: 8px 0;
      font-family: Georgia, serif;
      font-size: 34px;
      font-weight: 500;
    }

    .stats-grid-v2 article p {
      color: var(--muted);
      margin: 0;
      font-size: 10px;
      line-height: 1.5;
    }

    .admin-columns-v2 {
      display: grid;
      grid-template-columns: 1.35fr .65fr;
      gap: 18px;
      margin-top: 18px;
    }

    .admin-panel-card h2,
    .admin-section-heading-v2 h2 {
      margin: 6px 0 10px;
      font-family: Georgia, serif;
      font-size: 28px;
      font-weight: 500;
    }

    .admin-section-heading-v2 {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-end;
      margin-bottom: 18px;
    }

    .admin-section-heading-v2 p {
      max-width: 760px;
      color: var(--muted);
      margin: 0;
      font-size: 11px;
      line-height: 1.5;
    }

    .priority-order-list {
      display: grid;
      gap: 8px;
    }

    .priority-order-list button {
      width: 100%;
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      gap: 18px;
      text-align: left;
      padding: 12px 14px;
    }

    .priority-order-list button span:last-child {
      text-align: right;
    }

    .priority-order-list strong,
    .priority-order-list small {
      display: block;
    }

    .priority-order-list small {
      color: var(--muted);
      margin-top: 3px;
      font-size: 9px;
    }

    .admin-summary-list {
      display: grid;
      gap: 0;
      margin: 0 0 18px;
    }

    .admin-summary-list div {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      border-bottom: 1px solid var(--line);
      padding: 10px 0;
    }

    .admin-summary-list dt {
      color: var(--muted);
    }

    .admin-summary-list dd {
      margin: 0;
      font-weight: 800;
    }

    .admin-search-v2 {
      display: grid;
      gap: 6px;
      margin-bottom: 16px;
      font-size: 10px;
      font-weight: 800;
    }

    .admin-search-v2 input,
    .admin-filter-grid input,
    .admin-filter-grid select {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--line);
      background: #fff;
      color: inherit;
      border-radius: 7px;
      padding: 9px 11px;
    }

    .admin-filter-grid {
      display: grid;
      grid-template-columns: 1fr 260px 220px;
      gap: 12px;
      margin-bottom: 18px;
    }

    .admin-filter-grid label {
      display: grid;
      gap: 6px;
      font-size: 10px;
      font-weight: 800;
    }

    .legacy-review-list,
    .admin-order-list-v2 {
      display: grid;
      gap: 10px;
    }

    .legacy-product-row,
    .admin-order-row-v2 {
      border: 1px solid var(--line);
      background: #fffdfa;
      border-radius: 10px;
      overflow: hidden;
    }

    .legacy-product-summary {
      display: grid;
      grid-template-columns: 92px minmax(0,1fr) auto auto;
      gap: 18px;
      align-items: center;
      padding: 16px;
    }

    .legacy-item-number {
      color: var(--forest);
      font-weight: 850;
    }

    .legacy-product-summary h3 {
      margin: 4px 0;
      font-size: 15px;
    }

    .legacy-product-summary p,
    .legacy-price-summary small {
      color: var(--muted);
      margin: 0;
      font-size: 9px;
    }

    .legacy-price-summary {
      text-align: right;
    }

    .legacy-price-summary strong,
    .legacy-price-summary small {
      display: block;
    }

    .admin-pill {
      display: inline-block;
      border-radius: 999px;
      padding: 4px 7px;
      font-size: 8px;
      font-weight: 850;
      letter-spacing: .05em;
      text-transform: uppercase;
    }

    .admin-pill.is-published {
      background: #d8eadf;
      color: #286448;
    }

    .admin-pill.is-review {
      background: #f4dfbd;
      color: #875d20;
    }

    .legacy-product-detail[hidden],
    .admin-inline-detail[hidden] {
      display: none;
    }

    .legacy-product-detail,
    .admin-inline-detail {
      border-top: 1px solid var(--line);
      padding: 16px;
    }

    .legacy-detail-card {
      background: var(--cream);
      border-radius: 9px;
      padding: 20px;
    }

    .legacy-detail-grid {
      display: grid;
      grid-template-columns: 1.25fr .75fr;
      gap: 26px;
    }

    .legacy-detail-card h3 {
      margin: 6px 0 16px;
      font-family: Georgia, serif;
      font-size: 24px;
      font-weight: 500;
    }

    .legacy-image-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 16px;
    }

    .legacy-image-grid img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: contain;
      background: #eeeae2;
      border-radius: 7px;
    }

    .legacy-photo-files {
      display: grid;
      gap: 6px;
      background: #fff;
      border: 1px dashed var(--line);
      border-radius: 7px;
      padding: 12px;
      margin-bottom: 16px;
      word-break: break-word;
    }

    .legacy-photo-files span {
      color: var(--muted);
      font-size: 9px;
    }

    .legacy-field-list {
      display: grid;
      gap: 0;
      margin: 0;
    }

    .legacy-field-list div {
      border-bottom: 1px solid rgba(0,0,0,.08);
      padding: 9px 0;
    }

    .legacy-field-list dt {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .05em;
      font-size: 8px;
      font-weight: 850;
    }

    .legacy-field-list dd {
      margin: 4px 0 0;
      white-space: pre-wrap;
      line-height: 1.5;
      font-size: 10px;
    }

    .admin-recovery-note {
      margin-top: 16px;
      border: 1px solid #e3c98b;
      background: #fff6df;
      border-radius: 7px;
      padding: 12px;
      font-size: 10px;
      line-height: 1.5;
    }

    .admin-recovery-note.is-good {
      border-color: #bcd6c6;
      background: #edf5f0;
    }

    .pricing-table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 10px;
    }

    .pricing-table-v2 {
      width: 100%;
      border-collapse: collapse;
      background: #fffdfa;
      font-size: 9px;
    }

    .pricing-table-v2 th,
    .pricing-table-v2 td {
      border-bottom: 1px solid var(--line);
      text-align: left;
      padding: 11px 10px;
      vertical-align: top;
    }

    .pricing-table-v2 th {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .05em;
      background: #f3efe7;
      font-size: 8px;
    }

    .pricing-table-v2 td strong,
    .pricing-table-v2 td small {
      display: block;
    }

    .pricing-table-v2 td small {
      color: var(--muted);
      margin-top: 3px;
    }

    .batch-grid-v2 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .batch-grid-v2 h3 {
      margin: 6px 0 10px;
      font-family: Georgia, serif;
      font-size: 23px;
      font-weight: 500;
    }

    .batch-grid-v2 article > strong {
      display: block;
      margin-bottom: 7px;
    }

    .batch-grid-v2 p,
    .batch-grid-v2 small {
      color: var(--muted);
      line-height: 1.5;
    }

    .future-batch-card {
      border-style: dashed !important;
    }

    .admin-order-row-v2 {
      display: grid;
      grid-template-columns: minmax(0,1fr) auto auto;
      gap: 20px;
      align-items: center;
      padding: 16px;
    }

    .admin-order-row-v2 > div:not(.admin-inline-detail) {
      display: grid;
      gap: 4px;
    }

    .admin-order-row-v2 small {
      color: var(--muted);
    }

    .admin-inline-detail {
      grid-column: 1 / -1;
      margin: 0 -16px -16px;
    }

    .admin-order-detail-v2 {
      background: var(--cream);
      padding: 22px;
    }

    .admin-order-detail-v2 h2 {
      margin: 5px 0 18px;
      font-family: Georgia, serif;
      font-size: 25px;
      font-weight: 500;
    }

    .order-detail-columns {
      display: grid;
      grid-template-columns: 1fr .75fr;
      gap: 28px;
    }

    .order-detail-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-top: 18px;
    }

    .admin-empty-v2,
    .admin-error-card {
      border: 1px dashed var(--line);
      background: #fffdfa;
      border-radius: 10px;
      padding: 30px;
      color: var(--muted);
    }


    .admin-product-editor {
      display: grid;
      gap: 18px;
    }

    .admin-photo-editor,
    .admin-data-editor {
      border: 2px solid var(--line);
      border-radius: 12px;
      padding: 18px;
      background: #fffdfa;
    }

    .public-data-editor {
      border-color: #a8c6b4;
    }

    .internal-data-editor {
      border-color: #d4ba82;
      background: #fff9ec;
    }

    .admin-product-editor-columns {
      display: grid;
      grid-template-columns:
        minmax(0,1.25fr)
        minmax(300px,.75fr);
      gap: 18px;
    }

    .admin-editor-heading {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      border-bottom: 1px solid var(--line);
      padding-bottom: 12px;
      margin-bottom: 15px;
    }

    .admin-editor-heading span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .08em;
    }

    .admin-editor-heading strong {
      display: block;
      margin-top: 4px;
      font-size: 16px;
    }

    .admin-data-editor form {
      display: grid;
      gap: 12px;
    }

    .admin-data-editor form label {
      display: grid;
      gap: 5px;
      font-size: 10px;
      font-weight: 800;
    }

    .admin-data-editor input,
    .admin-data-editor textarea,
    .admin-data-editor select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #fff;
      color: inherit;
      padding: 9px 10px;
      font: inherit;
    }

    .admin-editor-checkbox {
      display: flex !important;
      align-items: center;
      gap: 8px !important;
    }

    .admin-editor-checkbox input {
      width: auto;
    }

    .admin-form-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }

    .admin-upload-label {
      cursor: pointer;
    }

    .admin-photo-grid-v2 {
      display: grid;
      grid-template-columns:
        repeat(
          auto-fill,
          minmax(175px,1fr)
        );
      gap: 12px;
    }

    .admin-photo-grid-v2 article {
      position: relative;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #fff;
      padding: 8px;
    }

    .admin-photo-grid-v2 img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: contain;
      display: block;
      background: #eeeae2;
      border-radius: 6px;
    }

    .admin-photo-grid-v2 article > b {
      position: absolute;
      left: 14px;
      top: 14px;
      border-radius: 999px;
      background: var(--forest);
      color: #fff;
      padding: 5px 8px;
      font-size: 8px;
      letter-spacing: .05em;
    }

    .admin-photo-grid-v2 article > div {
      display: grid;
      gap: 5px;
      margin-top: 7px;
    }

    .admin-photo-grid-v2 button {
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 5px;
      padding: 6px;
      font-size: 9px;
      cursor: pointer;
    }

    .admin-no-photo-v2 {
      border: 1px dashed var(--line);
      background: #fff;
      border-radius: 8px;
      padding: 16px;
    }

    .admin-no-photo-v2 small {
      color: var(--muted);
      word-break: break-word;
    }

    @media (max-width: 860px) {
      .admin-topbar,
      .admin-section-heading-v2 {
        flex-direction: column;
        align-items: stretch;
      }

      .admin-top-actions {
        justify-content: flex-start;
      }

      .stats-grid-v2,
      .batch-grid-v2,
      .admin-columns-v2,
      .legacy-detail-grid,
      .order-detail-columns,
      .admin-product-editor-columns {
        grid-template-columns: 1fr;
      }

      .admin-filter-grid {
        grid-template-columns: 1fr;
      }

      .legacy-product-summary,
      .admin-order-row-v2 {
        grid-template-columns: 1fr;
      }

      .legacy-price-summary {
        text-align: left;
      }

      .admin-inline-detail {
        grid-column: 1;
      }
    }
  `;

  document.head.appendChild(
    style
  );
}