const ADMIN_SESSION_KEY = 'mudanza-admin-token';

const ADMIN_STATE = {
  token: '',
  activeTab: 'overview',
  orders: [],
  buyerGroups: [],
  fulfillmentBatches: [],
  inventory: [],
  batches: [],
  stats: {},
  orderFilter: 'ACTIVE',
  orderSearch: '',
  inventorySearch: '',
  inventoryBatch: 'ALL',
  inventoryStatus: 'ALL',
  reviewSearch: '',
  pricingSearch: '',
  marketingPacket: null,
  marketingDate: '',
  marketingSlotKey: '',
  marketingLoadedKey: '',
  marketingLoadingKey: '',
  marketingError: '',
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


async function fetchBuyerGroups() {
  const data = await adminFetch(
    '/api/admin/buyer-groups'
  );
  return data.buyerGroups || [];
}


async function fetchFulfillmentBatches() {
  const data = await adminFetch(
    '/api/admin/fulfillment-batches'
  );
  return data.fulfillmentBatches || [];
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
      buyerGroups,
      fulfillmentBatches,
    ] =
      await Promise.all([
        fetchAdminOrders(),
        fetchLegacyInventory(),
        fetchBuyerGroups(),
        fetchFulfillmentBatches(),
      ]);

    ADMIN_STATE.orders =
      orders;

    ADMIN_STATE.buyerGroups =
      buyerGroups;

    ADMIN_STATE.fulfillmentBatches =
      fulfillmentBatches;

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

  const sourceDrift =
    products.filter(
      (product) =>
        product.sourceSyncRequired
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

    sourceDrift,

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
  injectMarketingStyles();

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
          'buyer-sheets',
          'Planillas',
          ADMIN_STATE.fulfillmentBatches.filter(
            (batch) => !batch.mergedIntoBatchId && batch.items.length > 0
          ).length
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

        ${adminTabButton(
          'marketing',
          'Marketing'
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

  if (
    ADMIN_STATE.activeTab ===
    'buyer-sheets'
  ) {
    renderBuyerSheetsTab();
    return;
  }

  if (
    ADMIN_STATE.activeTab ===
    'marketing'
  ) {
    renderMarketingTab();
    return;
  }

  renderOverviewTab();
}


const MARKETING_SLOTS = [
  ['MONDAY_AM', 'Monday AM'],
  ['MONDAY_PM', 'Monday PM'],
  ['TUESDAY_AM', 'Tuesday AM'],
  ['TUESDAY_PM', 'Tuesday PM'],
  ['WEDNESDAY_AM', 'Wednesday AM'],
  ['WEDNESDAY_PM', 'Wednesday PM'],
  ['THURSDAY_AM', 'Thursday AM'],
  ['THURSDAY_PM', 'Thursday PM'],
  ['FRIDAY_AM', 'Friday AM'],
  ['FRIDAY_PM', 'Friday PM'],
];

const MARKETING_DAY_KEYS = [
  '',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  '',
];


function marketingDefaults() {
  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'America/Asuncion',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      hourCycle: 'h23',
    }
  ).formatToParts(new Date());
  const value = (type) =>
    parts.find((part) => part.type === type)?.value || '';
  let date = `${value('year')}-${value('month')}-${value('day')}`;
  let weekday = value('weekday').toUpperCase();
  const cursor = new Date(`${date}T12:00:00Z`);
  while (!MARKETING_DAY_KEYS[cursor.getUTCDay()]) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (cursor.toISOString().slice(0, 10) !== date) {
    date = cursor.toISOString().slice(0, 10);
    weekday = MARKETING_DAY_KEYS[cursor.getUTCDay()];
  }
  const period = Number(value('hour')) < 13 ? 'AM' : 'PM';
  const slotKey = `${weekday}_${period}`;
  return {
    date,
    slotKey: MARKETING_SLOTS.some(([key]) => key === slotKey)
      ? slotKey
      : 'MONDAY_AM',
  };
}


function marketingProductUrl(product) {
  return `/producto/${encodeURIComponent(product.slug)}`;
}


function marketingSelectionKey(date, slotKey) {
  return `${date}:${slotKey}`;
}


function renderMarketingPacket(packet) {
  if (!packet) {
    return `
      <div class="marketing-empty">
        <h3>Prepará una vista previa</h3>
        <p>La selección usa el estado público actual y no envía ningún correo.</p>
      </div>`;
  }

  const sent = packet.status === 'SENT';
  const sending = packet.status === 'SENDING';
  const failed = packet.status === 'FAILED';
  const statusLabel = sent ? 'Enviado' : sending ? 'Enviando' : failed ? 'Falló el envío' : 'Borrador';
  return `
    <section class="marketing-preview" aria-live="polite">
      <div class="marketing-preview-heading">
        <div>
          <span class="section-kicker">VISTA PREVIA</span>
          <h3>${adminEscape(packet.subject)}</h3>
          <p>${adminEscape(packet.slotDate)} · ${adminEscape(packet.slotLabel)}</p>
        </div>
        <span class="admin-pill ${sent ? 'is-published' : ''}">
          ${statusLabel}
        </span>
      </div>

      <section class="marketing-copy-card">
        <div class="marketing-section-title">
          <h4>1. LISTO PARA COPIAR Y PEGAR</h4>
          <button class="secondary-action" type="button" data-copy-marketing>Copiar texto</button>
        </div>
        <pre>${adminEscape(packet.socialCopy)}</pre>
      </section>

      <section>
        <h4>2. FOTOS PARA PUBLICAR</h4>
        <div class="marketing-photo-grid">
          ${packet.products.map((product) => `
            <article>
              <img src="${adminEscape(product.images[0])}" alt="${adminEscape(`Item ${String(product.itemNumber).padStart(3, '0')} — ${product.title}`)}">
              <strong>Item ${String(product.itemNumber).padStart(3, '0')}</strong>
              <span>${adminEscape(product.title)}</span>
            </article>`).join('')}
        </div>
      </section>

      <section class="marketing-links">
        <h4>3. ENLACES DIRECTOS</h4>
        <ul>
          ${packet.products.map((product) => `
            <li><a href="${marketingProductUrl(product)}" target="_blank" rel="noreferrer">Item ${String(product.itemNumber).padStart(3, '0')} — ${adminEscape(product.title)} ↗</a></li>`).join('')}
        </ul>
      </section>

      <div class="marketing-actions">
        <button class="secondary-action" type="button" data-regenerate-marketing ${!['DRAFT', 'FAILED'].includes(packet.status) ? 'disabled' : ''}>
          Regenerar selección
        </button>
        <button class="primary-action" type="button" data-send-marketing ${sent || sending ? 'disabled' : ''}>
          ${sent ? 'Enviado a Maria' : sending ? 'Enviando…' : 'Enviar a Maria'}
        </button>
      </div>
      <p class="form-error" data-marketing-action-error hidden></p>
    </section>`;
}


function renderMarketingTab() {
  const target = document.getElementById('admin-tab-content');
  const defaults = marketingDefaults();
  if (!ADMIN_STATE.marketingDate) ADMIN_STATE.marketingDate = defaults.date;
  if (!ADMIN_STATE.marketingSlotKey) ADMIN_STATE.marketingSlotKey = defaults.slotKey;
  const selectionKey = marketingSelectionKey(
    ADMIN_STATE.marketingDate,
    ADMIN_STATE.marketingSlotKey
  );
  const shouldLoad = ADMIN_STATE.marketingLoadedKey !== selectionKey &&
    ADMIN_STATE.marketingLoadingKey !== selectionKey;
  if (shouldLoad) ADMIN_STATE.marketingLoadingKey = selectionKey;
  const loading = ADMIN_STATE.marketingLoadingKey === selectionKey;
  const packet = ADMIN_STATE.marketingLoadedKey === selectionKey
    ? ADMIN_STATE.marketingPacket
    : null;
  target.innerHTML = `
    <section class="admin-content-v2 marketing-admin">
      <header class="admin-section-heading">
        <div>
          <span class="section-kicker">CORREO DE MARKETING</span>
          <h2>Publicación lista para Maria</h2>
          <p>Generá, revisá y enviá un solo correo con productos disponibles en este momento.</p>
        </div>
      </header>

      <form class="admin-panel-card marketing-generator" data-marketing-form>
        <label>
          <span>Fecha</span>
          <input type="date" name="slotDate" value="${adminEscape(ADMIN_STATE.marketingDate)}" required>
        </label>
        <label>
          <span>Franja</span>
          <select name="slotKey" required>
            ${MARKETING_SLOTS.map(([key, label]) => `
              <option value="${key}" ${ADMIN_STATE.marketingSlotKey === key ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <button class="primary-action" type="submit" ${loading || packet ? 'disabled' : ''}>
          ${loading ? 'Buscando…' : packet ? 'Vista previa guardada' : 'Generar vista previa'}
        </button>
        <p class="form-error" data-marketing-error ${ADMIN_STATE.marketingError ? '' : 'hidden'}>${adminEscape(ADMIN_STATE.marketingError)}</p>
      </form>

      <div data-marketing-preview>
        ${loading ? `
          <div class="marketing-empty">
            <h3>Buscando vista previa guardada…</h3>
            <p>La fecha y la franja conservan su propio borrador.</p>
          </div>` : renderMarketingPacket(packet)}
      </div>
    </section>`;

  bindMarketingActions();
  if (shouldLoad) void loadMarketingDraft(ADMIN_STATE.marketingDate, ADMIN_STATE.marketingSlotKey);
}


async function loadMarketingDraft(slotDate, slotKey) {
  const selectionKey = marketingSelectionKey(slotDate, slotKey);
  try {
    const query = new URLSearchParams({ slotDate, slotKey });
    const result = await adminFetch(`/api/admin/marketing-preview?${query}`);
    if (marketingSelectionKey(ADMIN_STATE.marketingDate, ADMIN_STATE.marketingSlotKey) !== selectionKey) return;
    ADMIN_STATE.marketingPacket = result.packet;
    ADMIN_STATE.marketingLoadedKey = selectionKey;
    ADMIN_STATE.marketingError = '';
  } catch (error) {
    if (marketingSelectionKey(ADMIN_STATE.marketingDate, ADMIN_STATE.marketingSlotKey) !== selectionKey) return;
    ADMIN_STATE.marketingPacket = null;
    ADMIN_STATE.marketingLoadedKey = selectionKey;
    ADMIN_STATE.marketingError = error instanceof Error
      ? error.message
      : 'No se pudo buscar la vista previa guardada.';
  } finally {
    if (ADMIN_STATE.marketingLoadingKey === selectionKey) ADMIN_STATE.marketingLoadingKey = '';
    if (marketingSelectionKey(ADMIN_STATE.marketingDate, ADMIN_STATE.marketingSlotKey) === selectionKey) {
      renderMarketingTab();
    }
  }
}


function bindMarketingActions() {
  const form = document.querySelector('[data-marketing-form]');
  const selectSlot = (date, slotKey) => {
    ADMIN_STATE.marketingDate = date;
    ADMIN_STATE.marketingSlotKey = slotKey;
    ADMIN_STATE.marketingPacket = null;
    ADMIN_STATE.marketingLoadedKey = '';
    ADMIN_STATE.marketingError = '';
    renderMarketingTab();
  };
  const generate = async (regenerate = false) => {
    const errorBox = document.querySelector('[data-marketing-error]');
    const submit = form?.querySelector('button[type="submit"]');
    if (errorBox) errorBox.hidden = true;
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Generando…';
    }
    try {
      const data = new FormData(form);
      const result = await adminFetch('/api/admin/marketing-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotDate: String(data.get('slotDate') || ''),
          slotKey: String(data.get('slotKey') || ''),
          regenerate,
        }),
      });
      ADMIN_STATE.marketingPacket = result.packet;
      ADMIN_STATE.marketingDate = result.packet.slotDate;
      ADMIN_STATE.marketingSlotKey = result.packet.slotKey;
      ADMIN_STATE.marketingLoadedKey = marketingSelectionKey(
        result.packet.slotDate,
        result.packet.slotKey
      );
      ADMIN_STATE.marketingError = '';
      renderMarketingTab();
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error instanceof Error ? error.message : 'No se pudo generar la vista previa.';
        errorBox.hidden = false;
      }
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Generar vista previa';
      }
    }
  };

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void generate(false);
  });
  form?.querySelector('input[name="slotDate"]')?.addEventListener('change', (event) => {
    const date = String(event.currentTarget.value || '');
    const day = MARKETING_DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    const select = form.querySelector('select[name="slotKey"]');
    if (!day || !select) return;
    const period = String(select.value).endsWith('_PM') ? 'PM' : 'AM';
    selectSlot(date, `${day}_${period}`);
  });
  form?.querySelector('select[name="slotKey"]')?.addEventListener('change', (event) => {
    const date = String(form.querySelector('input[name="slotDate"]')?.value || '');
    selectSlot(date, String(event.currentTarget.value || ''));
  });
  document.querySelector('[data-regenerate-marketing]')?.addEventListener('click', () => {
    void generate(true);
  });
  document.querySelector('[data-copy-marketing]')?.addEventListener('click', async (event) => {
    await navigator.clipboard.writeText(ADMIN_STATE.marketingPacket?.socialCopy || '');
    event.currentTarget.textContent = 'Copiado';
  });
  document.querySelector('[data-send-marketing]')?.addEventListener('click', async (event) => {
    const packet = ADMIN_STATE.marketingPacket;
    if (!packet || !window.confirm('¿Enviar este correo una sola vez a Maria?')) return;
    const button = event.currentTarget;
    const errorBox = document.querySelector('[data-marketing-action-error]');
    button.disabled = true;
    button.textContent = 'Enviando…';
    if (errorBox) errorBox.hidden = true;
    try {
      const result = await adminFetch('/api/admin/marketing-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packetId: packet.id }),
      });
      ADMIN_STATE.marketingPacket = result.packet;
      ADMIN_STATE.marketingLoadedKey = marketingSelectionKey(
        result.packet.slotDate,
        result.packet.slotKey
      );
      renderMarketingTab();
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error instanceof Error ? error.message : 'No se pudo enviar el correo.';
        errorBox.hidden = false;
      }
      button.disabled = false;
      button.textContent = 'Enviar a Maria';
    }
  });
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
          'Fuente ≠ producción',
          stats.sourceDrift,
          'Items 001–057 cuyo catálogo base no coincide con los datos públicos activos.'
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

  const syncState =
    product.sourceSyncRequired
      ? `
        <span class="admin-pill is-review">
          Fuente ≠ producción
        </span>
      `
      : '';

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
          ${syncState}

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
      ${
        product.sourceSyncRequired
          ? `
            <div class="admin-error-card">
              <strong>
                Fuente y producción no coinciden
              </strong>

              <p>
                Campos distintos:
                ${adminEscape(
                  (product.sourceMismatchFields || [])
                    .join(', ')
                )}
              </p>

              <p>
                Este artículo debe reconciliarse antes de cerrar este trabajo o pasar a otro workstream.
              </p>

              ${
                (product.sourceMismatchFields || [])
                  .some((field) => field !== 'images')
                  ? `
                    <button
                      type="button"
                      class="primary-action"
                      data-sync-source
                    >
                      Sincronizar producción con fuente
                    </button>
                  `
                  : ''
              }
            </div>
          `
          : ''
      }

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

    <p class="admin-editor-guidance">
      Indicá en la descripción pública los defectos importantes conocidos, por ejemplo: grietas, astillas, rayones, manchas, piezas faltantes, daños visibles o desgaste significativo, aunque también se vean en las fotos.
    </p>

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
      '[data-sync-source]'
    )
    ?.addEventListener(
      'click',
      async () => {
        if (
          !window.confirm(
            '¿Sincronizar los campos públicos distintos con la fuente confirmada del sitio?'
          )
        ) {
          return;
        }

        try {
          await syncAdminProductSource(
            product.id
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

async function syncAdminProductSource(
  productId
) {
  return adminFetch(
    '/.netlify/functions/admin-sync-product-source',
    {
      method: 'POST',

      headers: {
        'content-type':
          'application/json',
      },

      body:
        JSON.stringify({
          productId,
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


function renderBuyerSheetsTab() {
  const target = document.getElementById('admin-tab-content');
  const printable = ADMIN_STATE.fulfillmentBatches.filter(
    (batch) => !batch.mergedIntoBatchId && batch.items.length > 0
  );

  target.innerHTML = `
    <section class="admin-content-v2 buyer-sheets-view">
      <div class="admin-section-heading-v2">
        <div>
          <span class="section-kicker">PLANILLAS DE INVENTARIO</span>
          <h2>Lotes de preparación por comprador</h2>
          <p>Cada planilla representa un lote persistido. Preparar congela sus artículos antes de imprimir.</p>
        </div>
        <strong>${printable.length} planilla${printable.length === 1 ? '' : 's'}</strong>
      </div>

      <div class="buyer-sheet-list">
        ${printable.length ? printable.map((batch) => {
          const combineTargets = printable.filter((candidate) =>
            candidate.fulfillmentBatchId !== batch.fulfillmentBatchId &&
            candidate.buyerGroupId === batch.buyerGroupId &&
            candidate.timingKey === batch.timingKey &&
            candidate.status !== 'DELIVERED'
          );
          return `
          <article class="buyer-sheet" data-fulfillment-batch="${adminEscapeAttribute(batch.fulfillmentBatchId)}">
            <header>
              <span>COMPRADOR</span>
              <h2>${adminEscape(batch.displayName)}</h2>
              <strong>${adminEscape(batch.displayPhone || 'Sin teléfono')}</strong>
              <small>Identidad ${adminEscape(batch.buyerGroupId)}</small>
              <small>Lote ${adminEscape(batch.fulfillmentBatchId)} · revisión ${Number(batch.revision)}</small>
            </header>

            <div class="fulfillment-batch-meta">
              <strong>${adminEscape(batch.timingLabel)}</strong>
              <span class="fulfillment-status is-${adminEscapeAttribute(batch.status.toLowerCase())}">${adminEscape(fulfillmentStatusLabel(batch.status))}</span>
            </div>

            <table>
              <thead><tr><th>Artículo</th><th>Descripción</th><th>Cantidad</th><th>Pedido</th><th>Control</th></tr></thead>
              <tbody>
                ${batch.items.map((item) => `
                  <tr>
                    <td>${adminEscape(adminFormatItem(item.itemNumber))}</td>
                    <td>${adminEscape(item.title)}</td>
                    <td>${item.quantity == null ? 'Sin dato' : Number(item.quantity)}</td>
                    <td>${adminEscape(item.orderId)}</td>
                    <td class="buyer-sheet-checks">
                      <span>☐ Preparado</span>
                      <span>☐ Entregado</span>
                      <button class="text-action fulfillment-item-action" type="button"
                        data-separate-batch="${adminEscapeAttribute(batch.fulfillmentBatchId)}"
                        data-separate-order="${adminEscapeAttribute(item.orderId)}"
                        data-separate-product="${adminEscapeAttribute(item.productId)}">
                        Separar artículo
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div class="fulfillment-batch-actions">
              ${batch.status === 'OPEN' ? `
                <button class="primary-action" type="button" data-prepare-batch="${adminEscapeAttribute(batch.fulfillmentBatchId)}">
                  Preparar e imprimir
                </button>
              ` : `
                <button class="primary-action" type="button" data-reprint-batch="${adminEscapeAttribute(batch.fulfillmentBatchId)}">
                  Imprimir nuevamente
                </button>
              `}
              ${['PREPARED', 'LEGACY_FROZEN'].includes(batch.status) ? `
                <button class="secondary-action" type="button" data-deliver-batch="${adminEscapeAttribute(batch.fulfillmentBatchId)}">
                  Marcar entregado
                </button>
              ` : ''}
              ${['PREPARED', 'LEGACY_FROZEN'].includes(batch.status) ? `
                <button class="secondary-action" type="button" data-reopen-batch="${adminEscapeAttribute(batch.fulfillmentBatchId)}">
                  Reabrir lote
                </button>
              ` : ''}
              ${batch.status !== 'DELIVERED' && combineTargets.length ? `
                <label class="fulfillment-combine-control">
                  <span>Combinar con</span>
                  <select data-combine-target="${adminEscapeAttribute(batch.fulfillmentBatchId)}">
                    <option value="">Seleccionar lote…</option>
                    ${combineTargets.map((candidate) => `
                      <option value="${adminEscapeAttribute(candidate.fulfillmentBatchId)}">
                        ${adminEscape(candidate.fulfillmentBatchId)} · ${adminEscape(fulfillmentStatusLabel(candidate.status))}
                      </option>
                    `).join('')}
                  </select>
                </label>
                <button class="secondary-action" type="button" data-combine-batch="${adminEscapeAttribute(batch.fulfillmentBatchId)}">
                  Combinar lotes
                </button>
              ` : ''}
            </div>
          </article>
        `; }).join('') : '<div class="admin-empty-v2">Todavía no hay artículos confirmados para preparar.</div>'}
      </div>
    </section>
  `;

  target.querySelectorAll('[data-prepare-batch]').forEach((button) => {
    button.addEventListener('click', () => prepareAndPrintFulfillmentBatch(
      button.getAttribute('data-prepare-batch')
    ));
  });
  target.querySelectorAll('[data-reprint-batch]').forEach((button) => {
    button.addEventListener('click', () => printFulfillmentBatch(
      button.getAttribute('data-reprint-batch')
    ));
  });
  target.querySelectorAll('[data-deliver-batch]').forEach((button) => {
    button.addEventListener('click', () => deliverFulfillmentBatch(
      button.getAttribute('data-deliver-batch')
    ));
  });
  target.querySelectorAll('[data-reopen-batch]').forEach((button) => {
    button.addEventListener('click', () => reopenFulfillmentBatch(
      button.getAttribute('data-reopen-batch')
    ));
  });
  target.querySelectorAll('[data-combine-batch]').forEach((button) => {
    button.addEventListener('click', () => combineFulfillmentBatch(
      button.getAttribute('data-combine-batch')
    ));
  });
  target.querySelectorAll('[data-separate-batch]').forEach((button) => {
    button.addEventListener('click', () => separateFulfillmentItem({
      batchId: button.getAttribute('data-separate-batch'),
      orderId: button.getAttribute('data-separate-order'),
      productId: button.getAttribute('data-separate-product'),
    }));
  });
}


function fulfillmentStatusLabel(status) {
  return ({
    OPEN: 'Abierto',
    PREPARED: 'Preparado',
    DELIVERED: 'Entregado',
    LEGACY_FROZEN: 'Histórico congelado',
  })[status] || status;
}


function fulfillmentBatchById(batchId) {
  return ADMIN_STATE.fulfillmentBatches.find(
    (batch) => batch.fulfillmentBatchId === batchId
  );
}


async function updateFulfillmentBatch(payload) {
  const result = await adminFetch('/api/admin/fulfillment-batches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const byId = new Map(ADMIN_STATE.fulfillmentBatches.map(
    (batch) => [batch.fulfillmentBatchId, batch]
  ));
  for (const batch of result.changedBatches || []) {
    byId.set(batch.fulfillmentBatchId, batch);
  }
  ADMIN_STATE.fulfillmentBatches = [...byId.values()];
  const printableCount = ADMIN_STATE.fulfillmentBatches.filter(
    (batch) => !batch.mergedIntoBatchId && batch.items.length > 0
  ).length;
  const planillasBadge = document.querySelector('[data-admin-tab="buyer-sheets"] span');
  if (planillasBadge) planillasBadge.textContent = String(printableCount);
  renderBuyerSheetsTab();
  return result;
}


async function prepareAndPrintFulfillmentBatch(batchId) {
  const batch = fulfillmentBatchById(batchId);
  if (!batch || !window.confirm('Preparar congela esta planilla antes de imprimir. ¿Continuar?')) return;
  try {
    await updateFulfillmentBatch({
      action: 'PREPARE',
      batchId,
      expectedRevision: batch.revision,
    });
    printFulfillmentBatch(batchId);
  } catch (error) {
    alert(error instanceof Error ? error.message : 'No se pudo preparar el lote.');
  }
}


async function deliverFulfillmentBatch(batchId) {
  const batch = fulfillmentBatchById(batchId);
  if (!batch) return;
  const isHistorical = batch.status === 'LEGACY_FROZEN';
  const confirmation = isHistorical
    ? '¿Confirmar que este lote histórico ya fue entregado? Esta acción registra la entrega sin reabrir ni volver a preparar el lote.'
    : '¿Confirmar que este lote fue entregado?';
  if (!window.confirm(confirmation)) return;
  try {
    const payload = { action: 'DELIVER', batchId, expectedRevision: batch.revision };
    if (isHistorical) payload.confirmFrozen = true;
    await updateFulfillmentBatch(payload);
  } catch (error) {
    alert(error instanceof Error ? error.message : 'No se pudo marcar el lote como entregado.');
  }
}


async function reopenFulfillmentBatch(batchId) {
  const batch = fulfillmentBatchById(batchId);
  if (!batch || !window.confirm('Reabrir permite que nuevas compras compatibles entren en este lote. ¿Continuar?')) return;
  try {
    await updateFulfillmentBatch({ action: 'REOPEN', batchId, expectedRevision: batch.revision });
  } catch (error) {
    alert(error instanceof Error ? error.message : 'No se pudo reabrir el lote.');
  }
}


async function combineFulfillmentBatch(batchId) {
  const source = fulfillmentBatchById(batchId);
  const targetId = document.querySelector(
    `[data-combine-target="${CSS.escape(batchId)}"]`
  )?.value;
  const target = fulfillmentBatchById(targetId);
  if (!source || !target) {
    alert('Seleccioná el lote de destino.');
    return;
  }
  if (!window.confirm('Combinar moverá todos los artículos al lote seleccionado. ¿Continuar?')) return;
  try {
    await updateFulfillmentBatch({
      action: 'COMBINE',
      batchId,
      targetBatchId: targetId,
      expectedRevision: source.revision,
      expectedTargetRevision: target.revision,
      confirmFrozen: source.status !== 'OPEN' || target.status !== 'OPEN',
    });
  } catch (error) {
    alert(error instanceof Error ? error.message : 'No se pudieron combinar los lotes.');
  }
}


async function separateFulfillmentItem({ batchId, orderId, productId }) {
  const batch = fulfillmentBatchById(batchId);
  if (!batch || !window.confirm('¿Separar este artículo en otro lote del mismo comprador?')) return;
  try {
    await updateFulfillmentBatch({
      action: 'SEPARATE',
      batchId,
      orderId,
      productIds: [productId],
      expectedRevision: batch.revision,
      confirmFrozen: batch.status !== 'OPEN',
    });
  } catch (error) {
    alert(error instanceof Error ? error.message : 'No se pudo separar el artículo.');
  }
}


function printFulfillmentBatch(batchId) {
  const sheet = document.querySelector(
    `[data-fulfillment-batch="${CSS.escape(batchId)}"]`
  );
  if (!sheet) return;
  document.getElementById('buyer-sheet-print-root')?.remove();
  const printRoot = document.createElement('div');
  printRoot.id = 'buyer-sheet-print-root';
  const printable = sheet.cloneNode(true);
  printable.querySelectorAll('.fulfillment-batch-actions, .fulfillment-item-action').forEach(
    (element) => element.remove()
  );
  printRoot.append(printable);
  document.body.append(printRoot);
  document.body.classList.add('printing-buyer-sheet');
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing-buyer-sheet');
    printRoot.remove();
  }, { once: true });
  window.print();
}


let ADMIN_LEGACY_REVIEW_SUCCESS = '';


function renderOrdersTab() {
  const target =
    document.getElementById(
      'admin-tab-content'
    );

  const normalizedSearch = adminNormalizeSearch(
    ADMIN_STATE.orderSearch
  );

  const cancelledCount = ADMIN_STATE.orders.filter(
    (order) => order.status === 'CANCELLED'
  ).length;

  const visibleOrders = ADMIN_STATE.orders.filter(
    (order) => {
      if (normalizedSearch) {
        return adminOrderSearchText(order).includes(
          normalizedSearch
        );
      }

      return adminOrderMatchesFilter(
        order,
        ADMIN_STATE.orderFilter
      );
    }
  );

  const rows =
    visibleOrders.length
      ? visibleOrders
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
                  <span>
                    Total del pedido:
                    <strong>${adminMoney(order.totals?.totalPYG)}</strong>
                  </span>

                  <span>
                    Pagado:
                    <strong>${adminMoney(order.paidAmountPYG || 0)}</strong>
                  </span>

                  <span>
                    Saldo:
                    <strong>${adminMoney(order.remainingBalancePYG ?? order.totals?.totalPYG ?? 0)}</strong>
                  </span>

                  <span>
                    ${order.status === 'AWAITING_INITIAL_PAYMENT' && order.holdExpiresAt
                      ? `Esperando transferencia - reservado hasta ${adminEscape(adminOrderDeadline(order.holdExpiresAt))}`
                      : adminStatus(order.status)}
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
          ${ADMIN_STATE.orders.length
            ? 'No hay pedidos que coincidan con esta búsqueda o filtro.'
            : 'Todavía no hay pedidos en este entorno.'}
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

      <section class="admin-content-v2" id="admin-legacy-reconciliation-review">
        <h3>Reconciliación histórica revisada</h3>
        <p>Cargando pagos aprobados…</p>
      </section>

      <div class="admin-order-tools-v2">
        <label class="admin-search-v2">
          <span>Buscar pedido o cliente</span>
          <input
            type="search"
            value="${adminEscapeAttribute(ADMIN_STATE.orderSearch)}"
            placeholder="N.º de pedido, nombre, teléfono o email"
            data-admin-order-search
          >
        </label>

        <div class="admin-order-filters-v2" aria-label="Filtrar pedidos por estado">
          ${[
            ['ACTIVE', 'Activos'],
            ['WAITING', 'Esperando pago'],
            ['RECEIPT', 'Comprobante recibido'],
            ['PAID', 'Pagados'],
            ['CANCELLED', 'Cancelados'],
            ['ALL', 'Todos'],
          ].map(([value, label]) => `
            <button
              class="${ADMIN_STATE.orderFilter === value ? 'primary-action' : 'secondary-action'}"
              type="button"
              data-admin-order-filter="${value}"
              aria-pressed="${ADMIN_STATE.orderFilter === value}"
            >
              ${label}
            </button>
          `).join('')}
        </div>

        ${ADMIN_STATE.orderFilter === 'CANCELLED'
          ? `<button class="secondary-action" type="button" data-admin-cancelled-toggle="ACTIVE">Ocultar pedidos cancelados</button>`
          : ADMIN_STATE.orderFilter === 'ALL'
            ? ''
            : `<button class="secondary-action" type="button" data-admin-cancelled-toggle="CANCELLED">Mostrar pedidos cancelados (${cancelledCount})</button>`}
      </div>

      <div class="admin-order-list-v2">
        ${rows}
      </div>
      <section class="admin-content-v2" id="admin-upcoming-pickups">
        <h2>Próximos retiros</h2><p>Cargando…</p>
      </section>
    </section>
  `;

  loadLegacyReconciliationReviewQueue();
  loadUpcomingPickups();

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

  target
    .querySelector('[data-admin-order-search]')
    ?.addEventListener('input', function (event) {
      ADMIN_STATE.orderSearch = event.target.value;
      renderOrdersTab();
      const input = document.querySelector('[data-admin-order-search]');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });

  target
    .querySelectorAll('[data-admin-order-filter]')
    .forEach((button) => {
      button.addEventListener('click', function () {
        ADMIN_STATE.orderFilter = button.getAttribute('data-admin-order-filter');
        renderOrdersTab();
      });
    });

  target
    .querySelector('[data-admin-cancelled-toggle]')
    ?.addEventListener('click', function (event) {
      ADMIN_STATE.orderFilter = event.currentTarget.getAttribute('data-admin-cancelled-toggle');
      ADMIN_STATE.orderSearch = '';
      renderOrdersTab();
    });
}


function renderLegacyReviewGroup(title, entries) {
  if (!entries.length) return '';
  return `
    <section class="admin-order-list-v2">
      <h4>${adminEscape(title)}</h4>
      ${entries.map(entry => `
        <article class="admin-order-row-v2" data-legacy-review-card>
          <div>
            <strong>${adminEscape(entry.orderId)}</strong>
            <span>${adminEscape(entry.customer)}</span>
            <small>Pago: ${adminEscape(entry.paymentId)}</small>
          </div>
          <div>
            <span>Importe: <strong>${adminMoney(entry.amountPYG)}</strong></span>
            <span>Origen actual: <strong>${adminEscape(entry.currentSource)}</strong></span>
            <span>Base propuesta: <strong>${adminEscape(entry.basis)}</strong></span>
            <span>${adminEscape(entry.evidenceLabel)}</span>
          </div>
          <p><strong>Nota interna propuesta:</strong> ${adminEscape(entry.proposedNote)}</p>
          <div>
            ${entry.receiptAvailable ? `
              <button class="secondary-action" type="button"
                data-legacy-review-receipt
                data-order-id="${adminEscapeAttribute(entry.orderId)}"
                data-payment-id="${adminEscapeAttribute(entry.paymentId)}">
                Ver comprobante / evidencia
              </button>
            ` : ''}
            ${entry.state === 'READY' ? `
              <button class="primary-action" type="button"
                data-confirm-legacy-review
                data-order-id="${adminEscapeAttribute(entry.orderId)}"
                data-payment-id="${adminEscapeAttribute(entry.paymentId)}"
                data-customer="${adminEscapeAttribute(entry.customer)}"
                data-amount="${adminEscapeAttribute(entry.amountPYG)}">
                Confirmar reconciliación
              </button>
            ` : `<strong role="alert">${adminEscape(entry.stateMessage)}</strong>`}
          </div>
          <p class="form-error" data-legacy-review-error role="alert" hidden></p>
        </article>
      `).join('')}
    </section>
  `;
}


async function loadLegacyReconciliationReviewQueue() {
  const target = document.getElementById('admin-legacy-reconciliation-review');
  if (!target) return;
  try {
    const data = await adminFetch('/api/admin/legacy-reconciliation-review');
    const priority = data.queue.filter(entry => entry.section === 'PRIORITY');
    const ordinary = data.queue.filter(entry => entry.section === 'ORDINARY');
    const special = data.queue.filter(entry => entry.section === 'SPECIAL');
    target.innerHTML = `
      <div class="admin-section-heading-v2">
        <div>
          <span class="section-kicker">LIMPIEZA TEMPORAL</span>
          <h3>Reconciliación histórica revisada</h3>
          <p>Cada pago requiere confirmación individual. No se infieren importes.</p>
        </div>
        <strong>${Number(data.remaining || 0)} pendiente${Number(data.remaining || 0) === 1 ? '' : 's'}</strong>
      </div>
      ${ADMIN_LEGACY_REVIEW_SUCCESS
        ? `<p role="status"><strong>${adminEscape(ADMIN_LEGACY_REVIEW_SUCCESS)}</strong></p>`
        : ''}
      ${data.queue.length
        ? `${renderLegacyReviewGroup('Prioridad: señas con saldo pendiente', priority)}
           ${renderLegacyReviewGroup('Pagos ordinarios con comprobante revisado', ordinary)}
           ${renderLegacyReviewGroup('Casos especiales confirmados', special)}`
        : '<p><strong>Todos los pagos aprobados fueron reconciliados.</strong></p>'}
    `;

    target.querySelectorAll('[data-legacy-review-receipt]').forEach(button => {
      button.addEventListener('click', () => viewAdminReceipt(
        button.dataset.orderId,
        button.dataset.paymentId
      ));
    });

    target.querySelectorAll('[data-confirm-legacy-review]').forEach(button => {
      button.addEventListener('click', async () => {
        const orderId = button.dataset.orderId;
        const paymentId = button.dataset.paymentId;
        const customer = button.dataset.customer;
        const amountPYG = Number(button.dataset.amount);
        const confirmed = window.confirm(
          `¿Confirmar la reconciliación de ${customer}, pedido ${orderId}, por ${adminMoney(amountPYG)}?`
        );
        if (!confirmed) return;
        const card = button.closest('[data-legacy-review-card]');
        const errorBox = card?.querySelector('[data-legacy-review-error]');
        if (errorBox) errorBox.hidden = true;
        button.disabled = true;
        try {
          await adminFetch('/api/admin/legacy-reconciliation-review', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderId, paymentId, ownerConfirmed: true }),
          });
          ADMIN_LEGACY_REVIEW_SUCCESS =
            `${customer} · ${orderId} · ${adminMoney(amountPYG)} reconciliado correctamente.`;
          ADMIN_STATE.orders = await fetchAdminOrders();
          ADMIN_STATE.stats = buildAdminStats(ADMIN_STATE.orders, ADMIN_STATE.inventory);
          renderOrdersTab();
        } catch (error) {
          button.disabled = false;
          if (errorBox) {
            errorBox.textContent = error instanceof Error
              ? error.message
              : 'No se pudo reconciliar este pago.';
            errorBox.hidden = false;
          }
        }
      });
    });
  } catch (error) {
    target.innerHTML = `
      <h3>Reconciliación histórica revisada</h3>
      <p class="form-error" role="alert">${adminEscape(
        error instanceof Error ? error.message : 'No se pudo cargar la revisión.'
      )}</p>
    `;
  }
}


function adminNormalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}


function adminOrderSearchText(order) {
  return adminNormalizeSearch([
    order.id,
    order.buyer?.name,
    order.buyer?.phone,
    order.buyer?.email,
  ].join(' '));
}


function adminOrderMatchesFilter(order, filter) {
  const status = order.status;

  const groups = {
    ACTIVE: status !== 'CANCELLED',
    WAITING: [
      'AWAITING_INITIAL_PAYMENT',
      'DEPOSIT_CONFIRMED',
      'BALANCE_DUE',
    ].includes(status),
    RECEIPT: [
      'RECEIPT_RECEIVED',
      'FINAL_RECEIPT_RECEIVED',
      'VERIFYING_PAYMENT',
    ].includes(status),
    PAID: [
      'PAYMENT_CONFIRMED',
      'PAID_IN_FULL',
      'READY_TO_SCHEDULE',
      'PICKUP_SCHEDULED',
      'PICKED_UP',
    ].includes(status),
    CANCELLED: status === 'CANCELLED',
    ALL: true,
  };

  return groups[filter] ?? groups.ACTIVE;
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
      .map((item) => {
        const delayed = item.saleMode === 'DELAYED';
        const pickupWindow = adminPickupWindow(item);

        return `
          <li class="admin-order-item ${delayed ? 'is-delayed' : 'is-immediate'}">
            <strong>${adminEscape(adminFormatItem(item.itemNumber))} · ${adminEscape(item.title)}</strong>
            <br>
            <span>Cantidad: ${item.quantity}</span>
            <div class="admin-order-item-fulfillment">
              <strong>${delayed ? 'RETIRO POSTERIOR' : 'RETIRO INMEDIATO'}</strong>
              ${delayed ? `<span>Seña ${Number(item.depositPercent || 0)}%</span>` : ''}
              ${delayed && pickupWindow ? `<span>Retiro: ${adminEscape(pickupWindow)}</span>` : ''}
            </div>
          </li>
        `;
      })
      .join('');

  const payments = order.payments || [];
  const paymentNotes = order.paymentNotes || [];
  const paymentAdjustments = order.paymentAdjustments || [];
  const nonVoidedConfirmedPayments = payments.filter(payment =>
    payment.verificationStatus === 'CONFIRMED' && payment.voidedAt == null);
  const pendingPayment = payments.find(payment => payment.verificationStatus === 'PENDING');
  const grossOrderTotal = Number(order.grossOrderTotalPYG ?? order.totals?.totalPYG ?? 0);
  const paidAmount = Number(order.paidAmountPYG || 0);
  const refundedAmount = Number(order.refundedAmountPYG || 0);
  const adjustedOrderTotal = Number(order.adjustedOrderTotalPYG ?? grossOrderTotal);
  const netReceived = Number(order.netReceivedPYG ?? paidAmount);
  const remainingBalance = Number(order.remainingBalancePYG ?? order.totals?.totalPYG ?? 0);
  const dueNow = Number(order.totals?.dueNowPYG ?? order.totals?.totalPYG ?? 0);
  const safeRefundableAmount = Math.max(0, Math.min(adjustedOrderTotal, netReceived));
  const canRecordAdjustment = order.status !== 'CANCELLED' && safeRefundableAmount > 0;
  const buyerGroup = ADMIN_STATE.buyerGroups.find(
    (group) => group.orders.some((candidate) => candidate.id === order.id)
  );
  const buyerGroupOrder = buyerGroup?.orders.find(
    (candidate) => candidate.id === order.id
  );

  const canCancel = !order.initialPaymentConfirmedAt &&
    ['AWAITING_INITIAL_PAYMENT', 'RESERVATION_EXPIRED', 'RECEIPT_RECEIVED', 'VERIFYING_PAYMENT'].includes(order.status);

  const canUploadReceipt = !pendingPayment && remainingBalance > 0 &&
    ['AWAITING_INITIAL_PAYMENT', 'RESERVATION_EXPIRED', 'DEPOSIT_CONFIRMED'].includes(order.status);

  const paymentHistory = payments.map((payment, index) => {
    const expectedAmount = adminExpectedPaymentAmount(
      order,
      payment,
      paidAmount,
      remainingBalance,
      dueNow
    );

    const confirmedAmount = payment.verificationStatus === 'CONFIRMED'
      ? Number(payment.amountPYG ?? expectedAmount)
      : 0;
    const voided = payment.voidedAt != null;
    const amountSource = payment.amountSource || 'LEGACY_ASSUMED';
    const historicalPayment = payment.verificationStatus === 'CONFIRMED' &&
      ['LEGACY_ASSUMED', 'LEGACY_RECONCILED', 'LEGACY_OPENING_CREDIT'].includes(amountSource);
    const legacyAssumed = historicalPayment && !voided && amountSource === 'LEGACY_ASSUMED';
    const voidEligible = historicalPayment && !voided && nonVoidedConfirmedPayments.length > 1;
    const voidNote = paymentNotes.find(note =>
      note.id === payment.voidNoteId &&
      note.kind === 'LEGACY_PAYMENT_VOID' &&
      note.relatedPaymentId === payment.id);

    return `
      <article class="admin-payment-entry">
        <strong>Comprobante ${index + 1}</strong>
        <span>Tipo: <strong>${adminPaymentType(payment.type)}</strong></span>
        <span>A pagar con este comprobante: <strong>${adminMoney(expectedAmount)}</strong></span>
        <span>${voided ? 'Importe original conservado' : 'Confirmado con este comprobante'}: <strong>${adminMoney(confirmedAmount)}</strong></span>
        <span>Pagado confirmado del pedido: <strong>${adminMoney(paidAmount)}</strong></span>
        <span>Saldo pendiente del pedido: <strong>${adminMoney(remainingBalance)}</strong></span>
        ${voided
          ? `<strong role="status">ANULADO — pago histórico duplicado</strong>
             <span>Anulado el ${adminEscape(adminOrderDeadline(payment.voidedAt))}</span>`
          : `<span>${payment.verificationStatus === 'CONFIRMED' ? 'Pago verificado' : 'Pendiente de verificación'}</span>`}
        ${voidNote ? `<p><strong>Nota interna de auditoría:</strong> ${adminEscape(voidNote.text)}</p>` : ''}
        ${legacyAssumed ? '<strong role="alert">Importe histórico asumido: requiere reconciliación antes de otro pago.</strong>' : ''}
        ${payment.receipt?.uploadedBy === 'ADMIN' ? '<span>Comprobante cargado por el vendedor</span>' : ''}
        ${payment.receipt ? `<button class="secondary-action" type="button" data-view-receipt="${adminEscape(payment.id)}">Ver comprobante</button>` : ''}
        ${legacyAssumed ? `
          <form data-reconcile-payment data-payment-id="${adminEscapeAttribute(payment.id)}">
            <label><span>Importe histórico establecido (PYG)</span>
              <input name="reconciledAmountPYG" type="number" min="1" step="1" inputmode="numeric" value="${confirmedAmount}" required>
            </label>
            <label><span>Base de la reconciliación</span>
              <select name="basis" required>
                <option value="ACTUAL_VERIFIED">Monto comprobado en banco/comprobante</option>
                <option value="SELLER_APPROVED_CREDIT">Crédito histórico aprobado por el vendedor</option>
              </select>
            </label>
            <label><span>Nota interna obligatoria</span>
              <textarea name="internalNote" maxlength="2000" required></textarea>
            </label>
            <p class="form-error" data-payment-reconciliation-error hidden></p>
            <button class="secondary-action" type="submit">Reconciliar pago histórico</button>
          </form>
        ` : ''}
        ${voidEligible ? `
          <form data-void-legacy-payment
            data-payment-id="${adminEscapeAttribute(payment.id)}"
            data-payment-amount="${adminEscapeAttribute(confirmedAmount)}">
            <label><span>Nota interna obligatoria para la anulación</span>
              <textarea name="internalNote" maxlength="2000" required></textarea>
            </label>
            <p class="form-error" data-payment-void-error hidden></p>
            <button class="secondary-action" type="submit">Anular pago histórico duplicado</button>
          </form>
        ` : ''}
      </article>
    `;
  }).join('');

  const adjustmentHistory = paymentAdjustments.map(adjustment => `
    <article class="admin-payment-entry">
      <strong>Ajuste de precio posterior a la venta</strong>
      <span>Importe reembolsado: <strong>${adminMoney(adjustment.amountPYG)}</strong></span>
      <span>Registrado: ${adminEscape(adminOrderDeadline(adjustment.createdAt))}</span>
      <p><strong>Nota interna de auditoría:</strong> ${adminEscape(adjustment.internalNote)}</p>
    </article>
  `).join('');

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
              ${order.status === 'AWAITING_INITIAL_PAYMENT' && order.holdExpiresAt
                ? `Esperando transferencia - reservado hasta ${adminEscape(adminOrderDeadline(order.holdExpiresAt))}`
                : adminStatus(order.status)}
            </strong>
          </p>

          ${order.status === 'RESERVATION_EXPIRED' ? `
            <div class="admin-expired-reservation" role="status">
              <strong>RESERVA VENCIDA</strong>
              <span>No indiques al cliente que transfiera hasta recuperar el inventario completo.</span>
            </div>
          ` : ''}

          <ul>
            ${items}
          </ul>
        </div>

        <div>
          <dl class="admin-summary-list">
            <div>
              <dt>TOTAL ORIGINAL</dt>

              <dd>
                ${adminMoney(
                  grossOrderTotal
                )}
              </dd>
            </div>

            <div>
              <dt>SEÑA / A PAGAR AHORA</dt>

              <dd>
                ${adminMoney(
                  dueNow
                )}
              </dd>
            </div>

            <div>
              <dt>PAGADO CONFIRMADO</dt>

              <dd>
                ${adminMoney(
                  paidAmount
                )}
              </dd>
            </div>

            <div>
              <dt>REEMBOLSADO / AJUSTADO</dt>
              <dd>${adminMoney(refundedAmount)}</dd>
            </div>

            <div>
              <dt>TOTAL AJUSTADO</dt>
              <dd>${adminMoney(adjustedOrderTotal)}</dd>
            </div>

            <div>
              <dt>NETO RETENIDO</dt>
              <dd>${adminMoney(netReceived)}</dd>
            </div>

            <div>
              <dt>SALDO PENDIENTE</dt>

              <dd>
                ${adminMoney(
                  remainingBalance
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <section class="admin-buyer-group-card">
        <h3>Identidad del comprador</h3>
        <p>
          Comprador vinculado:
          <strong>${adminEscape(buyerGroup?.displayName || order.buyer?.name || '')}</strong>
          · ${adminEscape(buyerGroup?.displayPhone || order.buyer?.phone || '')}
        </p>
        <small>
          ${buyerGroupOrder?.assignmentMode === 'MANUAL_SEPARATE'
            ? 'Este pedido se mantiene separado por decisión manual.'
            : buyerGroupOrder?.assignmentMode === 'MANUAL_MERGE'
              ? 'Este pedido fue combinado manualmente.'
              : 'Asignación automática conservadora: nombre y teléfono deben coincidir.'}
        </small>
        <p>La separación operativa se administra desde Planillas sin crear otra identidad.</p>
      </section>

      ${order.status === 'CANCELLED' ? '<p role="status"><strong>Pedido cancelado</strong>. Los artículos fueron liberados y volvieron a estar disponibles. El pedido se conserva para consulta.</p>' : ''}

      <section id="admin-pickup-editor"><h3>Retiro</h3><p>Cargando horarios…</p></section>

      <div class="order-detail-actions">
        ${canCancel ? `
          <div>
            <button class="secondary-action" type="button" data-cancel-order>
              CANCELAR PEDIDO Y LIBERAR ARTÍCULOS
            </button>
            <p>No se puede usar después de confirmar el pago.</p>
          </div>
        ` : ''}
        ${paymentHistory ? `<section class="admin-payment-history"><h3>Historial de pagos</h3>${paymentHistory}</section>` : ''}
        ${adjustmentHistory || canRecordAdjustment ? `
          <section class="admin-payment-history">
            <h3>Ajustes / reembolsos</h3>
            ${adjustmentHistory || '<p>Todavía no hay ajustes registrados.</p>'}
            ${canRecordAdjustment ? `
              <form data-post-sale-adjustment>
                <label><span>Importe del reembolso / ajuste (PYG)</span>
                  <input name="amountPYG" type="number" min="1" max="${adminEscapeAttribute(safeRefundableAmount)}"
                    step="1" inputmode="numeric" required>
                </label>
                <label><span>Tipo</span>
                  <select name="kind" required>
                    <option value="POST_SALE_PRICE_ADJUSTMENT">Ajuste de precio posterior a la venta</option>
                  </select>
                </label>
                <label><span>Nota interna obligatoria</span>
                  <textarea name="internalNote" maxlength="2000" required></textarea>
                </label>
                <small>Máximo reembolsable actualmente: ${adminMoney(safeRefundableAmount)}</small>
                <p class="form-error" data-post-sale-adjustment-error hidden></p>
                <button class="secondary-action" type="submit">Registrar reembolso / ajuste posterior a la venta</button>
              </form>
            ` : ''}
          </section>
        ` : ''}
        ${
          canUploadReceipt
              ? `
                <form data-admin-receipt-upload>
                  <label>
                    <span>${paidAmount > 0 ? 'Subir comprobante del saldo' : 'Subir comprobante recibido'}</span>
                    <input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required>
                  </label>
                  <small>JPEG, PNG, WebP o PDF. Máximo 3 MB.</small>
                  <p>La carga registra el comprobante, pero no confirma el pago.</p>
                  ${order.status === 'RESERVATION_EXPIRED' ? '<p>Antes de aceptar el archivo, el sistema intentará recuperar todos los artículos de forma atómica.</p>' : ''}
                  <p class="form-error" data-admin-receipt-error hidden></p>
                  <button class="primary-action" type="submit">Cargar comprobante por el cliente</button>
                </form>
              `
              : !paymentHistory ? `
              <span>
                Todavía no hay comprobante.
              </span>
            ` : ''
        }

        ${
          pendingPayment
            ? paidAmount > 0
              ? `<button class="primary-action" type="button" data-confirm-payment="FINAL" data-payment-id="${adminEscape(pendingPayment.id)}">Confirmar pago del saldo</button>`
              : Number(order.totals?.futureBalancePYG || 0) > 0
                ? `<button class="primary-action" type="button" data-confirm-payment="DEPOSIT" data-payment-id="${adminEscape(pendingPayment.id)}">Confirmar como seña</button>
                   <button class="secondary-action" type="button" data-confirm-payment="FULL" data-payment-id="${adminEscape(pendingPayment.id)}">Confirmar como pago total</button>`
                : `<button class="primary-action" type="button" data-confirm-payment="FULL" data-payment-id="${adminEscape(pendingPayment.id)}">Confirmar como pago total</button>`
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

  setupAdminPickup(order);

  target.querySelectorAll('[data-view-receipt]').forEach(button => {
    button.addEventListener('click', () => viewAdminReceipt(order.id, button.dataset.viewReceipt));
  });

  target.querySelectorAll('[data-reconcile-payment]').forEach(form => {
    form.addEventListener('submit', event => reconcileAdminPayment(event, order.id, form.dataset.paymentId));
  });

  target.querySelectorAll('[data-void-legacy-payment]').forEach(form => {
    form.addEventListener('submit', event => voidAdminLegacyDuplicatePayment(
      event,
      order.id,
      form.dataset.paymentId,
      Number(form.dataset.paymentAmount)
    ));
  });

  target.querySelector('[data-post-sale-adjustment]')?.addEventListener('submit', event =>
    recordAdminPostSaleAdjustment(event, order.id));

  target.querySelectorAll('[data-confirm-payment]').forEach(button => {
    button.addEventListener('click', () => confirmAdminPayment(
      order.id, button.dataset.paymentId, button.dataset.confirmPayment
    ));
  });

  target.querySelector('[data-admin-receipt-upload]')?.addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-admin-receipt-error]');
    button.disabled = true;
    errorBox.hidden = true;
    try {
      const data = new FormData(form);
      data.set('orderId', order.id);
      const result = await adminFetch('/api/admin/upload-receipt', { method: 'POST', body: data });
      ADMIN_STATE.orders = ADMIN_STATE.orders.map(item => item.id === order.id ? result.order : item);
      ADMIN_STATE.stats = buildAdminStats(ADMIN_STATE.orders, ADMIN_STATE.inventory);
      renderOrdersTab();
      await openAdminOrder(order.id);
    } catch (error) {
      button.disabled = false;
      errorBox.textContent = error instanceof Error ? error.message : 'No se pudo cargar el comprobante.';
      errorBox.hidden = false;
    }
  });

  target.querySelector('[data-cancel-order]')?.addEventListener('click', async function (event) {
    if (!window.confirm('¿Cancelar este pedido y volver a poner los artículos disponibles? No se puede usar después de confirmar el pago.')) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await adminFetch('/api/admin/cancel-order', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: order.id }),
      });
      ADMIN_STATE.orders = ADMIN_STATE.orders.map(item => item.id === order.id ? result.order : item);
      ADMIN_STATE.stats = buildAdminStats(ADMIN_STATE.orders, ADMIN_STATE.inventory);
      renderOrdersTab();
      await openAdminOrder(order.id);
    } catch (error) {
      button.disabled = false;
      alert(error instanceof Error ? error.message : 'No se pudo cancelar el pedido.');
    }
  });

}

async function loadUpcomingPickups() {
  const target = document.getElementById('admin-upcoming-pickups');
  if (!target) return;
  try {
    const data = await adminFetch('/api/admin/pickup');
    target.innerHTML = `<h2>Próximos retiros</h2>${data.upcoming.length ? `<ol>${data.upcoming.map(item =>
      `<li><strong>${adminEscape(item.slotKey.replace('|', ' · '))}</strong> · ${adminEscape(item.orderId)} · ${adminEscape(item.buyer)} · Items ${item.itemNumbers.map(n => adminEscape(String(n).padStart(3, '0'))).join(', ')}</li>`).join('')}</ol>` : '<p>No hay retiros próximos.</p>'}`;
  } catch (error) { target.innerHTML = `<h2>Próximos retiros</h2><p>${adminEscape(error.message)}</p>`; }
}

async function setupAdminPickup(order) {
  const target = document.getElementById('admin-pickup-editor');
  if (!target) return;
  try {
    const data = await adminFetch(`/api/admin/pickup?id=${encodeURIComponent(order.id)}`);
    const appointment = data.appointment?.status === 'SCHEDULED' ? data.appointment : null;
    target.innerHTML = `<h3>Retiro</h3>
      ${appointment ? `<p><strong>Agendado:</strong> ${adminEscape(appointment.slotKey.replace('|', ' · '))}</p>` : '<p>Sin horario agendado.</p>'}
      ${data.slots.length ? `<form data-admin-pickup-form>
        <label>Horario <select name="slotKey" required><option value="">Seleccioná fecha y horario</option>
          ${data.slots.filter(slot => slot.remaining > 0 || slot.selected).map(slot =>
            `<option value="${adminEscapeAttribute(slot.key)}">${adminEscape(slot.key.replace('|', ' · '))} · ${slot.remaining} lugar(es)</option>`).join('')}</select></label>
        <button class="primary-action" type="submit">${appointment ? 'Cambiar retiro' : 'Agendar retiro'}</button>
      </form>` : '<p>Disponible después de confirmar el pago total.</p>'}
      ${appointment ? '<button class="secondary-action" type="button" data-admin-cancel-pickup>Cancelar solo el retiro</button>' : ''}
      <p class="form-error" data-admin-pickup-error role="alert" hidden></p>`;
    const save = async slotKey => {
      const error = target.querySelector('[data-admin-pickup-error]');
      error.hidden = true;
      try {
        await adminFetch('/api/admin/pickup', { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: order.id, slotKey }) });
        await setupAdminPickup(order);
        await loadUpcomingPickups();
      } catch (problem) { error.textContent = problem.message; error.hidden = false; }
    };
    target.querySelector('form')?.addEventListener('submit', event => {
      event.preventDefault();
      save(new FormData(event.currentTarget).get('slotKey'));
    });
    target.querySelector('[data-admin-cancel-pickup]')?.addEventListener('click', () => save(null));
  } catch (error) { target.innerHTML = `<h3>Retiro</h3><p>${adminEscape(error.message)}</p>`; }
}


async function viewAdminReceipt(
  orderId,
  paymentId
) {
  const response =
    await fetch(
      `/api/admin/receipt?id=${encodeURIComponent(
        orderId
      )}&paymentId=${encodeURIComponent(paymentId || '')}`,
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
  orderId,
  paymentId,
  paymentType
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
            paymentId,
            paymentType,
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


async function reconcileAdminPayment(event, orderId, paymentId) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const errorBox = form.querySelector('[data-payment-reconciliation-error]');
  const button = form.querySelector('button[type="submit"]');
  errorBox.hidden = true;
  button.disabled = true;
  try {
    await adminFetch('/api/admin/payment-note', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId,
        action: 'RECONCILE_LEGACY_PAYMENT',
        paymentId,
        reconciledAmountPYG: data.get('reconciledAmountPYG'),
        basis: data.get('basis'),
        internalNote: data.get('internalNote'),
      }),
    });
    ADMIN_STATE.orders = await fetchAdminOrders();
    ADMIN_STATE.stats = buildAdminStats(ADMIN_STATE.orders, ADMIN_STATE.inventory);
    renderOrdersTab();
    setTimeout(() => openAdminOrder(orderId), 30);
  } catch (error) {
    button.disabled = false;
    errorBox.textContent = error instanceof Error ? error.message : 'No se pudo reconciliar el pago.';
    errorBox.hidden = false;
  }
}


async function voidAdminLegacyDuplicatePayment(event, orderId, paymentId, paymentAmountPYG) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const errorBox = form.querySelector('[data-payment-void-error]');
  const button = form.querySelector('button[type="submit"]');
  const confirmed = window.confirm(
    `¿Anular como duplicado el pago ${paymentId} por ${adminMoney(paymentAmountPYG)}? ` +
    'El registro y su comprobante se conservarán, pero dejará de contar como pagado.'
  );
  if (!confirmed) return;
  errorBox.hidden = true;
  button.disabled = true;
  try {
    await adminFetch('/api/admin/payment-note', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId,
        action: 'VOID_LEGACY_DUPLICATE_PAYMENT',
        paymentId,
        internalNote: data.get('internalNote'),
      }),
    });
    ADMIN_STATE.orders = await fetchAdminOrders();
    ADMIN_STATE.stats = buildAdminStats(ADMIN_STATE.orders, ADMIN_STATE.inventory);
    renderOrdersTab();
    setTimeout(() => openAdminOrder(orderId), 30);
  } catch (error) {
    button.disabled = false;
    errorBox.textContent = error instanceof Error ? error.message : 'No se pudo anular el pago histórico.';
    errorBox.hidden = false;
  }
}


async function recordAdminPostSaleAdjustment(event, orderId) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const amountPYG = Number(data.get('amountPYG'));
  const errorBox = form.querySelector('[data-post-sale-adjustment-error]');
  const button = form.querySelector('button[type="submit"]');
  const confirmed = window.confirm(
    `¿Registrar un reembolso / ajuste de ${adminMoney(amountPYG)} para el pedido ${orderId}? ` +
    'El pago original permanecerá sin cambios.'
  );
  if (!confirmed) return;
  errorBox.hidden = true;
  button.disabled = true;
  try {
    await adminFetch('/api/admin/payment-note', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId,
        action: 'RECORD_POST_SALE_PRICE_ADJUSTMENT',
        kind: data.get('kind'),
        amountPYG: data.get('amountPYG'),
        internalNote: data.get('internalNote'),
      }),
    });
    ADMIN_STATE.orders = await fetchAdminOrders();
    ADMIN_STATE.stats = buildAdminStats(ADMIN_STATE.orders, ADMIN_STATE.inventory);
    renderOrdersTab();
    setTimeout(() => openAdminOrder(orderId), 30);
  } catch (error) {
    button.disabled = false;
    errorBox.textContent = error instanceof Error
      ? error.message
      : 'No se pudo registrar el reembolso / ajuste.';
    errorBox.hidden = false;
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
    CANCELLED: 'Pedido cancelado',
    RESERVATION_EXPIRED: 'RESERVA VENCIDA',
    AWAITING_INITIAL_PAYMENT:
      'Esperando transferencia',

    RECEIPT_RECEIVED:
      'Comprobante recibido',

    FINAL_RECEIPT_RECEIVED:
      'Comprobante del saldo recibido',

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

    .admin-order-tools-v2 {
      display: grid;
      gap: 10px;
      margin-bottom: 18px;
    }

    .admin-order-tools-v2 .admin-search-v2 {
      margin-bottom: 0;
    }

    .admin-order-filters-v2 {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
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

    .admin-order-item {
      margin-bottom: 12px;
      padding: 12px;
      border-left: 4px solid var(--forest);
      background: #fffdfa;
    }

    .admin-order-item.is-delayed {
      border-left-color: #b27622;
      background: #fff8e7;
    }

    .admin-order-item-fulfillment {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      margin-top: 8px;
      font-size: 10px;
      letter-spacing: .02em;
    }

    .admin-order-item.is-delayed .admin-order-item-fulfillment strong {
      color: #85530d;
    }

    .order-detail-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-top: 18px;
    }

    .admin-payment-history {
      flex: 1 1 100%;
      display: grid;
      gap: 10px;
    }

    .admin-payment-entry {
      display: grid;
      gap: 4px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fffdfa;
    }

    .admin-buyer-group-card {
      margin-top: 18px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fffdfa;
    }

    .admin-buyer-group-card h3 {
      margin: 0 0 8px;
    }

    .admin-expired-reservation {
      display: grid;
      gap: 6px;
      margin: 14px 0;
      padding: 14px;
      border: 2px solid #9c2f24;
      border-radius: 9px;
      background: #fff0ed;
      color: #6f1f18;
    }

    .admin-buyer-group-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }

    .admin-buyer-group-actions select {
      flex: 1 1 320px;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #fff;
      padding: 9px 11px;
    }

    .buyer-sheet-list {
      display: grid;
      gap: 18px;
    }

    .buyer-sheet {
      border: 2px solid var(--forest);
      border-radius: 12px;
      background: #fff;
      padding: 24px;
    }

    .buyer-sheet header span,
    .buyer-sheet header small {
      display: block;
      color: var(--muted);
    }

    .buyer-sheet header h2 {
      margin: 5px 0;
      font-family: Georgia, serif;
      font-size: 34px;
      font-weight: 500;
    }

    .buyer-sheet header > strong {
      display: block;
      font-size: 24px;
    }

    .fulfillment-batch-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 16px;
      padding: 12px;
      border-radius: 8px;
      background: var(--cream);
    }

    .fulfillment-status {
      border-radius: 999px;
      padding: 5px 9px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    .fulfillment-status.is-open {
      color: #225f46;
      background: #dcefe5;
    }

    .fulfillment-status.is-prepared,
    .fulfillment-status.is-legacy_frozen {
      color: #78491f;
      background: #f4e4c6;
    }

    .fulfillment-status.is-delivered {
      color: #fff;
      background: var(--forest);
    }

    .fulfillment-batch-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 9px;
    }

    .fulfillment-combine-control {
      display: grid;
      gap: 4px;
      min-width: 290px;
    }

    .fulfillment-combine-control span {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .fulfillment-combine-control select {
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #fff;
      padding: 8px 10px;
    }

    .fulfillment-item-action {
      display: block;
      margin-top: 5px;
      padding: 0;
      font-size: 11px;
    }

    .buyer-sheet table {
      width: 100%;
      margin: 18px 0;
      border-collapse: collapse;
    }

    .buyer-sheet th,
    .buyer-sheet td {
      border-bottom: 1px solid var(--line);
      padding: 10px 8px;
      text-align: left;
    }

    .buyer-sheet-checks {
      min-width: 220px;
    }

    .buyer-sheet-checks span {
      display: inline-block;
      min-width: 102px;
      padding: 8px 4px;
      white-space: nowrap;
    }

    #buyer-sheet-print-root {
      display: none;
    }

    @media print {
      body.printing-buyer-sheet > :not(#buyer-sheet-print-root) {
        display: none !important;
      }

      body.printing-buyer-sheet #buyer-sheet-print-root {
        display: block !important;
      }

      body.printing-buyer-sheet #buyer-sheet-print-root .buyer-sheet {
        position: static;
        width: 100%;
        border: 0;
        padding: 0;
      }

      body.printing-buyer-sheet #buyer-sheet-print-root .buyer-sheet-print {
        display: none !important;
      }

      body.printing-buyer-sheet #buyer-sheet-print-root .fulfillment-batch-actions,
      body.printing-buyer-sheet #buyer-sheet-print-root .fulfillment-item-action {
        display: none !important;
      }

      body.printing-buyer-sheet #buyer-sheet-print-root thead {
        display: table-header-group;
      }

      body.printing-buyer-sheet #buyer-sheet-print-root tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
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

    .admin-editor-guidance {
      margin: 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
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


function adminOrderDeadline(value) {
  return new Date(Number(value)).toLocaleString('es-PY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}


function adminExpectedPaymentAmount(
  order,
  payment,
  paidAmount,
  remainingBalance,
  dueNow
) {
  if (payment.amountPYG != null) {
    return Number(payment.amountPYG || 0);
  }

  if (payment.type === 'FULL') {
    return Number(order.totals?.totalPYG || 0);
  }

  if (payment.type === 'DEPOSIT') {
    return dueNow;
  }

  if (payment.type === 'FINAL' || paidAmount > 0) {
    return remainingBalance;
  }

  return dueNow;
}


function adminPickupWindow(item) {
  if (!item.pickupWindowStart || !item.pickupWindowEnd) {
    return '';
  }

  const start = new Date(`${item.pickupWindowStart}T12:00:00`);
  const end = new Date(`${item.pickupWindowEnd}T12:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${item.pickupWindowStart}–${item.pickupWindowEnd}`;
  }

  const startDay = start.toLocaleDateString('es-PY', { day: 'numeric' });
  const endText = end.toLocaleDateString('es-PY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `${startDay}–${endText}`;
}


function adminPaymentType(type) {
  return ({
    DEPOSIT: 'Seña',
    FINAL: 'Pago del saldo',
    FULL: 'Pago total',
    PENDING: 'Pendiente de clasificación',
  })[type] || type || '';
}


function injectMarketingStyles() {
  if (document.getElementById('marketing-admin-styles')) return;
  const style = document.createElement('style');
  style.id = 'marketing-admin-styles';
  style.textContent = `
    .marketing-admin { display: grid; gap: 22px; }
    .marketing-generator { display: grid; grid-template-columns: minmax(170px, .8fr) minmax(190px, 1fr) auto; gap: 14px; align-items: end; }
    .marketing-generator label { display: grid; gap: 7px; font-weight: 700; }
    .marketing-generator input, .marketing-generator select { min-height: 46px; border: 1px solid #cfc7b9; border-radius: 10px; padding: 9px 11px; background: #fff; color: #26231f; font: inherit; }
    .marketing-generator .form-error { grid-column: 1 / -1; }
    .marketing-empty { padding: 42px 24px; border: 1px dashed #bdb4a5; border-radius: 16px; text-align: center; background: #faf8f4; }
    .marketing-empty h3, .marketing-empty p { margin: 0; }
    .marketing-empty p { margin-top: 8px; color: #655f56; }
    .marketing-preview { display: grid; gap: 24px; padding: 22px; border: 1px solid #d7d0c5; border-radius: 18px; background: #fff; }
    .marketing-preview-heading, .marketing-section-title, .marketing-actions { display: flex; gap: 14px; align-items: center; justify-content: space-between; }
    .marketing-preview-heading h3 { margin: 5px 0 0; }
    .marketing-preview-heading p { margin: 5px 0 0; color: #655f56; }
    .marketing-preview h4 { margin: 0 0 12px; font-size: .92rem; letter-spacing: .04em; }
    .marketing-section-title h4 { margin: 0; }
    .marketing-copy-card { padding: 18px; border-radius: 14px; background: #f5f1e9; }
    .marketing-copy-card pre { margin: 16px 0 0; white-space: pre-wrap; word-break: break-word; font: inherit; line-height: 1.55; }
    .marketing-photo-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .marketing-photo-grid article { display: grid; align-content: start; gap: 5px; overflow: hidden; border: 1px solid #ded8cd; border-radius: 12px; padding-bottom: 12px; }
    .marketing-photo-grid img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: contain; background: #f2eee7; }
    .marketing-photo-grid strong, .marketing-photo-grid span { padding: 0 12px; }
    .marketing-photo-grid span { color: #655f56; line-height: 1.35; }
    .marketing-links ul { display: grid; gap: 10px; margin: 0; padding-left: 20px; }
    .marketing-links a { color: #145c45; font-weight: 700; }
    .marketing-actions { justify-content: flex-end; padding-top: 4px; }
    @media (max-width: 720px) {
      .marketing-generator { grid-template-columns: 1fr; }
      .marketing-generator .form-error { grid-column: 1; }
      .marketing-photo-grid { grid-template-columns: 1fr; }
      .marketing-preview-heading, .marketing-section-title, .marketing-actions { align-items: stretch; flex-direction: column; }
      .marketing-actions button { width: 100%; }
    }
  `;
  document.head.appendChild(style);
}
