// File: js/checkout.js

const CHECKOUT_CART_KEY =
  'mudanza-demo-cart';

const LAST_ORDER_KEY =
  'mudanza-last-order';


window.addEventListener(
  'load',
  function () {
    installMyOrderLink();

    const path =
      window.location.pathname
        .replace(/\/+$/, '') || '/';

    if (path === '/checkout') {
      renderCheckoutPage();
      return;
    }

    if (
      path.startsWith('/pedido/')
    ) {
      renderOrderPage();
    }
  }
);


function installMyOrderLink() {
  let saved;

  try {
    saved =
      JSON.parse(
        localStorage.getItem(
          LAST_ORDER_KEY
        ) || 'null'
      );
  } catch {
    return;
  }

  if (
    !saved?.id ||
    !saved?.access
  ) {
    return;
  }

  const nav =
    document.querySelector(
      '.site-header nav'
    );

  if (
    !nav ||
    nav.querySelector(
      '.my-order-link'
    )
  ) {
    return;
  }

  const cartLink =
    nav.querySelector(
      '.cart-link'
    );

  const link =
    document.createElement('a');

  link.className =
    'my-order-link';

  link.href =
    `/pedido/${encodeURIComponent(
      saved.id
    )}?access=${encodeURIComponent(
      saved.access
    )}`;

  link.textContent =
    'Mi pedido';

  if (cartLink) {
    nav.insertBefore(
      link,
      cartLink
    );
  } else {
    nav.appendChild(link);
  }
}


function getCheckoutCart() {
  try {
    const stored =
      JSON.parse(
        localStorage.getItem(
          CHECKOUT_CART_KEY
        ) ||
        '{"ids":[],"quantities":{}}'
      );

    return {
      ids:
        Array.isArray(stored.ids)
          ? stored.ids
          : [],

      quantities:
        stored.quantities &&
        typeof stored.quantities ===
          'object'
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


function renderCheckoutPage() {
  const main =
    document.querySelector('main');

  if (!main) {
    return;
  }

  document.title =
    'Finalizar compra | Venta de Mudanza';

  const cart =
    getCheckoutCart();

  const products =
    cart.ids
      .map(
        (id) =>
          getEmbeddedProductById(id)
      )
      .filter(Boolean);

  if (!products.length) {
    main.innerHTML = `
      <section class="empty-cart">
        <span>Finalizar compra</span>
        <h1>Tu carrito está vacío.</h1>
        <p>
          Volvé al catálogo para elegir artículos.
        </p>
        <a
          class="primary-action"
          href="/#articulos"
        >
          Ver artículos
        </a>
      </section>
    `;

    return;
  }

  const items =
    products.map(
      (product) => {
        const quantity =
          Number(
            cart.quantities[
              product.id
            ] || 1
          );

        return {
          product,
          quantity,
        };
      }
    );

  const totals =
    items.reduce(
      (sum, entry) => {
        const unitDue =
          dueNowForProduct(
            entry.product
          );

        sum.total +=
          entry.product
            .askingPricePYG *
          entry.quantity;

        sum.dueNow +=
          unitDue *
          entry.quantity;

        sum.future +=
          (
            entry.product
              .askingPricePYG -
            unitDue
          ) *
          entry.quantity;

        return sum;
      },
      {
        total: 0,
        dueNow: 0,
        future: 0,
      }
    );

  const itemRows =
    items
      .map(
        ({ product, quantity }) => `
          <div class="checkout-item">
            <strong>
              ${escapeHtml(
                product.title
              )}
            </strong>

            <span>
              Cantidad:
              ${quantity}
            </span>

            <span>
              A pagar ahora:
              ${formatPYG(
                dueNowForProduct(
                  product
                ) * quantity
              )}
            </span>
          </div>
        `
      )
      .join('');

  main.innerHTML = `
    <section
      class="checkout-shell"
    >
      <div class="page-heading">
        <span class="section-kicker">
          FINALIZAR COMPRA
        </span>

        <h1>
          Tus datos
        </h1>

        <p>
          Primero creamos el pedido y
          retenemos temporalmente los
          artículos mientras realizás
          la transferencia.
        </p>
      </div>

      <div class="checkout-grid">

        <form
          id="checkout-form"
          class="checkout-card"
        >
          <label>
            <span>
              Nombre y apellido
            </span>

            <input
              type="text"
              name="name"
              autocomplete="name"
              required
            >
          </label>

          <label>
            <span>
              WhatsApp
            </span>

            <input
              type="tel"
              name="phone"
              autocomplete="tel"
              placeholder="+595..."
              required
            >
          </label>

          <label>
            <span>
              Email
              <small>
                (opcional)
              </small>
            </span>

            <input
              type="email"
              name="email"
              autocomplete="email"
            >
          </label>

          <p
            id="checkout-error"
            class="form-error"
            role="alert"
            hidden
          ></p>

          <button
            class="primary-action"
            type="submit"
          >
            Crear pedido y ver datos
            de transferencia
          </button>

          <small>
            Al continuar, los artículos
            se retienen temporalmente
            durante 45 minutos mientras
            realizás el pago y cargás
            el comprobante.
          </small>
        </form>

        <aside
          class="cart-summary"
        >
          <span class="section-kicker">
            RESUMEN
          </span>

          <h2>
            Tu compra
          </h2>

          <div
            class="checkout-items"
          >
            ${itemRows}
          </div>

          <dl>
            <div>
              <dt>
                Valor total
              </dt>

              <dd>
                ${formatPYG(
                  totals.total
                )}
              </dd>
            </div>

            <div
              class="summary-due"
            >
              <dt>
                A pagar ahora
              </dt>

              <dd>
                ${formatPYG(
                  totals.dueNow
                )}
              </dd>
            </div>

            <div>
              <dt>
                Saldo futuro
              </dt>

              <dd>
                ${formatPYG(
                  totals.future
                )}
              </dd>
            </div>
          </dl>
        </aside>

      </div>
    </section>
  `;

  injectCheckoutStyles();

  document
    .getElementById(
      'checkout-form'
    )
    ?.addEventListener(
      'submit',
      async function (event) {
        event.preventDefault();

        const form =
          event.currentTarget;

        const button =
          form.querySelector(
            'button[type="submit"]'
          );

        const errorBox =
          document.getElementById(
            'checkout-error'
          );

        const data =
          new FormData(form);

        button.disabled = true;

        button.textContent =
          'Creando pedido…';

        errorBox.hidden = true;

        try {
          const response =
            await fetch(
              '/api/orders/create',
              {
                method: 'POST',

                headers: {
                  'content-type':
                    'application/json',
                },

                body:
                  JSON.stringify({
                    buyer: {
                      name:
                        data.get(
                          'name'
                        ),

                      phone:
                        data.get(
                          'phone'
                        ),

                      email:
                        data.get(
                          'email'
                        ),
                    },

                    items:
                      items.map(
                        ({
                          product,
                          quantity,
                        }) => ({
                          productId:
                            product.id,

                          quantity,
                        })
                      ),
                  }),
              }
            );

          const result =
            await response.json();

          if (!response.ok) {
            throw new Error(
              result.error ||
              'No se pudo crear el pedido.'
            );
          }

          const saved = {
            id:
              result.order.id,

            access:
              result.accessToken,
          };

          localStorage.setItem(
            LAST_ORDER_KEY,
            JSON.stringify(saved)
          );

          localStorage.removeItem(
            CHECKOUT_CART_KEY
          );

          if (
            typeof updateStaticCartCount ===
            'function'
          ) {
            updateStaticCartCount();
          }

          window.location.assign(
            `/pedido/${encodeURIComponent(
              saved.id
            )}?access=${encodeURIComponent(
              saved.access
            )}`
          );
        } catch (error) {
          errorBox.textContent =
            error instanceof Error
              ? error.message
              : 'No se pudo crear el pedido.';

          errorBox.hidden = false;

          button.disabled = false;

          button.textContent =
            'Crear pedido y ver datos de transferencia';
        }
      }
    );
}


async function renderOrderPage() {
  const main =
    document.querySelector('main');

  if (!main) {
    return;
  }

  document.title =
    'Mi pedido | Venta de Mudanza';

  const path =
    window.location.pathname
      .replace(/\/+$/, '');

  const orderId =
    decodeURIComponent(
      path.slice(
        '/pedido/'.length
      )
    );

  const url =
    new URL(
      window.location.href
    );

  let access =
    url.searchParams.get(
      'access'
    );

  if (!access) {
    try {
      const saved =
        JSON.parse(
          localStorage.getItem(
            LAST_ORDER_KEY
          ) || 'null'
        );

      if (
        saved?.id === orderId
      ) {
        access =
          saved.access;
      }
    } catch {
      // Ignore invalid local state.
    }
  }

  if (!access) {
    main.innerHTML = `
      <section class="empty-cart">
        <span>Mi pedido</span>
        <h1>
          Falta el enlace privado.
        </h1>
        <p>
          Abrí el enlace original que
          recibiste al realizar la compra.
        </p>
      </section>
    `;

    return;
  }

  main.innerHTML = `
    <section class="empty-cart">
      <span>Mi pedido</span>
      <h1>
        Cargando pedido…
      </h1>
    </section>
  `;

  try {
    const response =
      await fetch(
        `/api/orders/get?id=${encodeURIComponent(
          orderId
        )}&access=${encodeURIComponent(
          access
        )}`,
        {
          cache: 'no-store',
        }
      );

    const result =
      await response.json();

    if (!response.ok) {
      throw new Error(
        result.error ||
        'No se pudo cargar el pedido.'
      );
    }

    localStorage.setItem(
      LAST_ORDER_KEY,
      JSON.stringify({
        id: orderId,
        access,
      })
    );

    displayOrder(
      result.order,
      access
    );
  } catch (error) {
    main.innerHTML = `
      <section class="empty-cart">
        <span>Mi pedido</span>

        <h1>
          No pudimos abrir el pedido.
        </h1>

        <p>
          ${escapeHtml(
            error instanceof Error
              ? error.message
              : 'Intentá nuevamente.'
          )}
        </p>
      </section>
    `;
  }
}


function displayOrder(
  order,
  access
) {
  const main =
    document.querySelector('main');

  const status =
    orderStatusLabel(
      order.status
    );

  const items =
    order.items
      .map(
        (item) => `
          <article class="order-item">
            ${
              item.image
                ? `
                  <img
                    src="/${stripLeadingSlash(
                      item.image
                    )}"
                    alt=""
                  >
                `
                : ''
            }

            <div>
              <strong>
                ${escapeHtml(
                  item.title
                )}
              </strong>

              <span>
                Cantidad:
                ${item.quantity}
              </span>

              <span>
                A pagar ahora:
                ${formatPYG(
                  item.dueNowPYG
                )}
              </span>

              ${
                item.futureBalancePYG >
                0
                  ? `
                    <span>
                      Saldo posterior:
                      ${formatPYG(
                        item.futureBalancePYG
                      )}
                    </span>
                  `
                  : ''
              }
            </div>
          </article>
        `
      )
      .join('');

  const awaitingPayment =
    order.status ===
    'AWAITING_INITIAL_PAYMENT';

  const receiptReceived =
    order.status ===
    'RECEIPT_RECEIVED';

  main.innerHTML = `
    <section
      class="order-shell"
    >
      <div class="page-heading">
        <span class="section-kicker">
          MI PEDIDO
        </span>

        <h1>
          ${escapeHtml(
            order.id
          )}
        </h1>

        <p>
          Pedido de
          ${escapeHtml(
            order.buyer.name
          )}
        </p>
      </div>

      <div class="order-status-card">
        <span>
          Estado actual
        </span>

        <strong>
          ${escapeHtml(status)}
        </strong>
      </div>

      <div class="checkout-grid">

        <section
          class="checkout-card"
        >
          <h2>
            Artículos
          </h2>

          ${items}
        </section>

        <aside
          class="cart-summary"
        >
          <span class="section-kicker">
            PAGO
          </span>

          <dl>
            <div>
              <dt>
                Valor total
              </dt>

              <dd>
                ${formatPYG(
                  order.totals
                    .totalPYG
                )}
              </dd>
            </div>

            <div
              class="summary-due"
            >
              <dt>
                A pagar ahora
              </dt>

              <dd>
                ${formatPYG(
                  order.totals
                    .dueNowPYG
                )}
              </dd>
            </div>

            <div>
              <dt>
                Saldo futuro
              </dt>

              <dd>
                ${formatPYG(
                  order.totals
                    .futureBalancePYG
                )}
              </dd>
            </div>
          </dl>

          ${
            awaitingPayment
              ? renderBankSection(
                  order,
                  access
                )
              : ''
          }

          ${
            receiptReceived
              ? `
                <div class="pickup-confirm">
                  <strong>
                    Comprobante recibido
                  </strong>

                  <span>
                    Ahora verificaremos que
                    los fondos hayan ingresado
                    a la cuenta. No necesitás
                    volver a cargarlo.
                  </span>
                </div>
              `
              : ''
          }
        </aside>

      </div>

      <a
        class="secondary-action"
        target="_blank"
        rel="noreferrer"
        href="https://wa.me/595972588347?text=${encodeURIComponent(
          `Hola, quisiera consultar por mi pedido ${order.id}.`
        )}"
      >
        Consultar por WhatsApp
      </a>
    </section>
  `;

  injectCheckoutStyles();

  if (awaitingPayment) {
    setupReceiptUpload(
      order,
      access
    );
  }
}


function renderBankSection(
  order,
  access
) {
  if (!order.bank?.configured) {
    return `
      <div class="pickup-confirm">
        <strong>
          Datos bancarios pendientes
        </strong>

        <span>
          No realices la transferencia
          todavía. Los datos bancarios
          se están configurando.
        </span>
      </div>
    `;
  }

  return `
    <div class="bank-details">
      <h3>
        Datos para transferencia
      </h3>

      <dl>
        <div>
          <dt>Banco</dt>
          <dd>
            ${escapeHtml(
              order.bank.bankName
            )}
          </dd>
        </div>

        <div>
          <dt>Titular</dt>
          <dd>
            ${escapeHtml(
              order.bank.accountName
            )}
          </dd>
        </div>

        <div>
          <dt>Cuenta</dt>
          <dd>
            ${escapeHtml(
              order.bank.accountNumber
            )}
          </dd>
        </div>

        ${
          order.bank.identification
            ? `
              <div>
                <dt>Documento</dt>
                <dd>
                  ${escapeHtml(
                    order.bank.identification
                  )}
                </dd>
              </div>
            `
            : ''
        }
      </dl>

      <p>
        Transferí exactamente
        <strong>
          ${formatPYG(
            order.totals.dueNowPYG
          )}
        </strong>.
      </p>

      <form
        id="receipt-form"
      >
        <label>
          <span>
            Subí tu comprobante
          </span>

          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            required
          >
        </label>

        <p
          id="receipt-error"
          class="form-error"
          role="alert"
          hidden
        ></p>

        <button
          class="primary-action"
          type="submit"
        >
          Enviar comprobante
        </button>

        <small>
          JPEG, PNG, WebP o PDF.
          Máximo 3 MB.
        </small>
      </form>
    </div>
  `;
}


function setupReceiptUpload(
  order,
  access
) {
  const form =
    document.getElementById(
      'receipt-form'
    );

  if (!form) {
    return;
  }

  form.addEventListener(
    'submit',
    async function (event) {
      event.preventDefault();

      const button =
        form.querySelector(
          'button[type="submit"]'
        );

      const errorBox =
        document.getElementById(
          'receipt-error'
        );

      const data =
        new FormData(form);

      data.append(
        'orderId',
        order.id
      );

      data.append(
        'access',
        access
      );

      button.disabled = true;

      button.textContent =
        'Enviando comprobante…';

      errorBox.hidden = true;

      try {
        const response =
          await fetch(
            '/api/orders/receipt',
            {
              method: 'POST',
              body: data,
            }
          );

        const result =
          await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ||
            'No se pudo enviar el comprobante.'
          );
        }

        displayOrder(
          result.order,
          access
        );
      } catch (error) {
        errorBox.textContent =
          error instanceof Error
            ? error.message
            : 'No se pudo enviar el comprobante.';

        errorBox.hidden = false;

        button.disabled = false;

        button.textContent =
          'Enviar comprobante';
      }
    }
  );
}


function orderStatusLabel(status) {
  const labels = {
    AWAITING_INITIAL_PAYMENT:
      'Esperando transferencia',

    RECEIPT_RECEIVED:
      'Comprobante recibido',

    VERIFYING_PAYMENT:
      'Verificando pago',

    INITIAL_PAYMENT_CONFIRMED:
      'Pago inicial confirmado',

    BALANCE_DUE:
      'Saldo pendiente',

    PAID_IN_FULL:
      'Pago completo',

    PAYMENT_CONFIRMED:
      'Pago confirmado',

    DEPOSIT_CONFIRMED:
      'Seña confirmada',
  
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


function injectCheckoutStyles() {
  if (
    document.getElementById(
      'checkout-extra-styles'
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      'style'
    );

  style.id =
    'checkout-extra-styles';

  style.textContent = `
    .checkout-shell,
    .order-shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 48px 24px 80px;
    }

    .checkout-grid {
      display: grid;
      grid-template-columns:
        minmax(0, 1.5fr)
        minmax(280px, .75fr);
      gap: 32px;
      align-items: start;
    }

    .checkout-card,
    .order-status-card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 24px;
    }

    .checkout-card {
      display: grid;
      gap: 18px;
    }

    .checkout-card label,
    #receipt-form label {
      display: grid;
      gap: 7px;
    }

    .checkout-card input,
    #receipt-form input {
      width: 100%;
      min-height: 46px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: white;
      color: inherit;
    }

    .checkout-items,
    .bank-details,
    #receipt-form {
      display: grid;
      gap: 14px;
    }

    .checkout-item,
    .order-item {
      display: grid;
      gap: 5px;
      padding: 14px 0;
      border-bottom:
        1px solid var(--line);
    }

    .order-item {
      grid-template-columns:
        86px 1fr;
    }

    .order-item img {
      width: 86px;
      height: 86px;
      object-fit: cover;
      border-radius: 10px;
    }

    .order-item > div {
      display: grid;
      gap: 5px;
    }

    .order-status-card {
      margin: 20px 0 28px;
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: center;
    }

    .order-status-card strong {
      font-size: 1.1rem;
    }

    .bank-details {
      margin-top: 18px;
      padding-top: 18px;
      border-top:
        1px solid var(--line);
    }

    .bank-details dl {
      display: grid;
      gap: 8px;
    }

    .bank-details dl > div {
      display: flex;
      justify-content: space-between;
      gap: 18px;
    }

    @media (max-width: 760px) {
      .checkout-grid {
        grid-template-columns: 1fr;
      }

      .order-status-card {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `;

  document.head.appendChild(
    style
  );
}