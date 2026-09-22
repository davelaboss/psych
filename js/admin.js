const ADMIN_SESSION_KEY = 'mudanza-admin-token';


window.addEventListener('load', function () {
  const path =
    window.location.pathname.replace(/\/+$/, '') || '/';

  if (path !== '/admin') {
    return;
  }

  renderAdmin();
});


function renderAdmin() {
  document.title =
    'Administración | Venta de Mudanza';

  const token =
    sessionStorage.getItem(ADMIN_SESSION_KEY);

  if (!token) {
    renderAdminLogin();
    return;
  }

  loadAdminOrders(token);
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

        <h1>Acceso vendedor</h1>

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
          <span>Clave</span>

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
          new FormData(event.currentTarget);

        const token =
          String(data.get('token') || '');

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

          loadAdminOrders(token);
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


async function fetchAdminOrders(token) {
  const response =
    await fetch(
      '/api/admin/orders',
      {
        headers: {
          'x-admin-token': token,
        },

        cache: 'no-store',
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


async function loadAdminOrders(token) {
  const main =
    document.querySelector('main');

  main.innerHTML = `
    <section class="empty-cart">
      <span>Administración</span>

      <h1>
        Cargando pedidos…
      </h1>
    </section>
  `;

  try {
    const orders =
      await fetchAdminOrders(token);

    renderAdminOrders(
      orders,
      token
    );
  } catch (error) {
    sessionStorage.removeItem(
      ADMIN_SESSION_KEY
    );

    renderAdminLogin();
  }
}


function renderAdminOrders(
  orders,
  token
) {
  const main =
    document.querySelector('main');

  const rows =
    orders.length
      ? orders
          .map(
            (order) => `
              <article
                class="admin-order-row"
                data-order-row="${adminEscape(
                  order.id
                )}"
              >
                <div class="admin-order-summary">
                  <strong>
                    ${adminEscape(order.id)}
                  </strong>

                  <span>
                    ${adminEscape(
                      order.buyer.name
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

                <div class="admin-order-payment">
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
                  data-admin-open="${adminEscape(
                    order.id
                  )}"
                  aria-expanded="false"
                >
                  Abrir pedido
                </button>

                <div
                  class="admin-inline-detail"
                  data-admin-detail="${adminEscape(
                    order.id
                  )}"
                  hidden
                ></div>
              </article>
            `
          )
          .join('')
      : `
        <div class="empty-cart">
          <h2>
            Todavía no hay pedidos.
          </h2>
        </div>
      `;

  main.innerHTML = `
    <section class="checkout-shell">
      <div class="page-heading">
        <span class="section-kicker">
          ADMINISTRACIÓN
        </span>

        <h1>Pedidos</h1>

        <p>
          ${orders.length}
          pedido${
            orders.length === 1
              ? ''
              : 's'
          }
        </p>

        <button
          id="admin-logout"
          class="text-action"
          type="button"
        >
          Cerrar sesión
        </button>
      </div>

      <div class="admin-order-list">
        ${rows}
      </div>
    </section>
  `;

  document
    .getElementById('admin-logout')
    ?.addEventListener(
      'click',
      function () {
        sessionStorage.removeItem(
          ADMIN_SESSION_KEY
        );

        renderAdminLogin();
      }
    );

  document
    .querySelectorAll(
      '[data-admin-open]'
    )
    .forEach((button) => {
      button.addEventListener(
        'click',
        function () {
          openAdminOrder(
            button.getAttribute(
              'data-admin-open'
            ),
            token
          );
        }
      );
    });

  injectAdminStyles();
}


async function openAdminOrder(
  orderId,
  token
) {
  const target =
    document.querySelector(
      `[data-admin-detail="${CSS.escape(
        orderId
      )}"]`
    );

  const button =
    document.querySelector(
      `[data-admin-open="${CSS.escape(
        orderId
      )}"]`
    );

  if (!target || !button) {
    return;
  }

  const alreadyOpen =
    !target.hidden;

  document
    .querySelectorAll(
      '.admin-inline-detail'
    )
    .forEach((detail) => {
      detail.hidden = true;
      detail.innerHTML = '';
    });

  document
    .querySelectorAll(
      '[data-admin-open]'
    )
    .forEach((openButton) => {
      openButton.setAttribute(
        'aria-expanded',
        'false'
      );

      openButton.textContent =
        'Abrir pedido';
    });

  if (alreadyOpen) {
    return;
  }

  target.hidden = false;

  target.innerHTML = `
    <p class="admin-loading">
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
    const response =
      await fetch(
        `/api/admin/order?id=${encodeURIComponent(
          orderId
        )}`,
        {
          headers: {
            'x-admin-token':
              token,
          },

          cache: 'no-store',
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        'No se pudo abrir el pedido.'
      );
    }

    renderAdminOrderDetail(
      data.order,
      token,
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
  token,
  target
) {
  const items =
    (order.items || [])
      .map(
        (item) => `
          <li>
            ${item.quantity} ×
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
    <section class="admin-order-detail">

      <span class="section-kicker">
        PEDIDO
      </span>

      <h2>
        ${adminEscape(
          order.id
        )}
      </h2>

      <p>
        <strong>
          ${adminEscape(
            order.buyer.name
          )}
        </strong>

        <br>

        WhatsApp:
        ${adminEscape(
          order.buyer.phone
        )}
      </p>

      ${
        order.buyer.email
          ? `
            <p>
              Email:
              ${adminEscape(
                order.buyer.email
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

      <p>
        A pagar ahora:
        <strong>
          ${adminMoney(
            order.totals
              ?.dueNowPYG
          )}
        </strong>
      </p>

      ${
        Number(
          order.totals
            ?.futureBalancePYG ||
          0
        ) > 0
          ? `
            <p>
              Saldo futuro:
              <strong>
                ${adminMoney(
                  order.totals
                    ?.futureBalancePYG
                )}
              </strong>
            </p>
          `
          : ''
      }

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
            <p>
              Todavía no hay comprobante.
            </p>
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
              Confirmé que los fondos
              ingresaron
            </button>
          `
          : ''
      }

      <a
        class="secondary-action"
        target="_blank"
        rel="noreferrer"
        href="https://wa.me/${String(
          order.buyer.phone || ''
        ).replace(/\D/g, '')}?text=${encodeURIComponent(
          `Hola ${order.buyer.name}, te escribo por tu pedido ${order.id}.`
        )}"
      >
        Escribir al comprador
      </a>

      <div
        class="admin-detail-message"
      ></div>
    </section>
  `;

  target
    .querySelector(
      '[data-view-receipt]'
    )
    ?.addEventListener(
      'click',
      function () {
        viewAdminReceipt(
          order.id,
          token
        );
      }
    );

  target
    .querySelector(
      '[data-confirm-payment]'
    )
    ?.addEventListener(
      'click',
      function () {
        confirmAdminPayment(
          order.id,
          token
        );
      }
    );
}


async function viewAdminReceipt(
  orderId,
  token
) {
  const response =
    await fetch(
      `/api/admin/receipt?id=${encodeURIComponent(
        orderId
      )}`,
      {
        headers: {
          'x-admin-token':
            token,
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
    URL.createObjectURL(blob);

  window.open(
    url,
    '_blank',
    'noopener,noreferrer'
  );

  setTimeout(
    () =>
      URL.revokeObjectURL(url),
    60000
  );
}


async function confirmAdminPayment(
  orderId,
  token
) {
  const confirmed =
    window.confirm(
      '¿Confirmás que verificaste personalmente que los fondos ingresaron a tu cuenta bancaria?'
    );

  if (!confirmed) {
    return;
  }

  const target =
    document.querySelector(
      `[data-admin-detail="${CSS.escape(
        orderId
      )}"]`
    );

  const button =
    target?.querySelector(
      '[data-confirm-payment]'
    );

  if (button) {
    button.disabled = true;

    button.textContent =
      'Confirmando…';
  }

  const response =
    await fetch(
      '/api/admin/confirm-payment',
      {
        method: 'POST',

        headers: {
          'content-type':
            'application/json',

          'x-admin-token':
            token,
        },

        body:
          JSON.stringify({
            orderId,
          }),
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    if (button) {
      button.disabled = false;

      button.textContent =
        'Confirmé que los fondos ingresaron';
    }

    alert(
      data.error ||
      'No se pudo confirmar el pago.'
    );

    return;
  }

  await loadAdminOrders(token);

  setTimeout(
    () =>
      openAdminOrder(
        orderId,
        token
      ),
    50
  );
}


function adminStatus(status) {
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
    status
  );
}


function adminMoney(value) {
  return (
    'Gs. ' +
    Number(
      value || 0
    ).toLocaleString(
      'es-PY'
    )
  );
}


function adminEscape(value) {
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


function injectAdminStyles() {
  if (
    document.getElementById(
      'admin-extra-styles'
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      'style'
    );

  style.id =
    'admin-extra-styles';

  style.textContent = `
    .admin-order-list {
      display: grid;
      gap: 12px;
      margin-top: 28px;
    }

    .admin-order-row {
      display: grid;
      grid-template-columns:
        minmax(0, 1fr)
        auto
        auto;
      gap: 24px;
      align-items: center;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--paper);
    }

    .admin-order-summary,
    .admin-order-payment {
      display: grid;
      gap: 4px;
    }

    .admin-inline-detail {
      grid-column: 1 / -1;
      margin-top: 4px;
      padding-top: 6px;
    }

    .admin-inline-detail[hidden] {
      display: none;
    }

    .admin-order-detail {
      padding: 26px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--cream);
      display: grid;
      gap: 18px;
    }

    .admin-order-detail ul {
      margin: 0;
      padding-left: 20px;
    }

    .admin-loading {
      margin: 10px 0;
    }

    @media (max-width: 760px) {
      .admin-order-row {
        grid-template-columns: 1fr;
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