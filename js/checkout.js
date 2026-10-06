// File: js/checkout.js

const CHECKOUT_CART_KEY =
  'mudanza-demo-cart';

const LAST_ORDER_KEY =
  'mudanza-last-order';

const CHECKOUT_ID_KEY =
  'mudanza-cart-checkout-id';


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

  const mobileMenu =
    nav.querySelector(
      '.mobile-nav-links'
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

  if (mobileMenu) {
    mobileMenu.appendChild(link);
  } else if (cartLink) {
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
      createdAt:
        Number(stored.createdAt || 0) || null,

      expiresAt:
        Number(stored.expiresAt || 0) || null,

      extensionUsed:
        Boolean(stored.extensionUsed),

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
      createdAt: null,
      expiresAt: null,
      extensionUsed: false,
      ids: [],
      quantities: {},
    };
  }
}


async function renderCheckoutPage() {
  const main =
    document.querySelector('main');

  if (!main) {
    return;
  }

  if (window.__staticCartReady) await window.__staticCartReady;
  if (window.__checkoutRecovery) {
    const recovered = window.__checkoutRecovery;
    window.location.replace(`/pedido/${encodeURIComponent(recovered.orderId)}?access=${encodeURIComponent(recovered.accessToken)}`);
    return;
  }

  try {
    const response = await fetch('/.netlify/functions/volume2-catalog', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar el catálogo.');
    const data = await response.json();
    if (!Array.isArray(data.products)) throw new Error('El catálogo no tiene el formato esperado.');
    window.__catalogProducts = data.products;
  } catch (error) {
    console.error('Checkout:', error);
    main.innerHTML = '<section class="empty-cart"><h1>No se pudo cargar el catálogo.</h1><p>Intentá nuevamente en unos minutos.</p></section>';
    return;
  }

  document.title =
    'Finalizar compra | Venta de Mudanza';

  const cart =
    getCheckoutCart();

  const leaseExpiresAt = Number(cart.expiresAt || 0);

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

            ${
              product.saleMode === 'DELAYED' &&
              product.askingPricePYG > dueNowForProduct(product)
                ? `
                  <span>
                    Saldo pendiente: ${formatPYG(
                      (product.askingPricePYG - dueNowForProduct(product)) * quantity
                    )}
                  </span>
                  <span>Pago final: ${DELAYED_FINAL_PAYMENT_WINDOW}</span>
                  <span>Retiro: ${escapeHtml(formatPickupWindow(
                    product.pickupWindowStart,
                    product.pickupWindowEnd
                  ))}</span>
                `
                : ''
            }
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
          Tu pedido quedará reservado por 2 horas mientras realizás la transferencia.
          Si no enviás el comprobante dentro de ese plazo, la reserva puede vencer y
          los artículos pueden volver a estar disponibles.
        </p>
        ${leaseExpiresAt ? `<p class="cart-lease-countdown" id="checkout-lease-countdown" data-expires-at="${leaseExpiresAt}">Tu carrito queda reservado por <strong></strong>.</p>` : ''}
        ${leaseExpiresAt ? `
          <div class="pickup-confirm" id="checkout-cart-extension" ${cart.extensionUsed ? '' : 'hidden'}>
            <strong>${cart.extensionUsed ? 'Reserva extendida' : '¿Necesitás más tiempo?'}</strong>
            <span>${cart.extensionUsed ? 'Tenés 20 minutos adicionales para terminar tu compra.' : 'Podés extender tu reserva una vez por 20 minutos para terminar de comprar.'}</span>
            ${cart.extensionUsed ? '' : '<button class="secondary-action" type="button" id="extend-checkout-reservation">Necesito más tiempo (+20 min)</button>'}
          </div>
        ` : ''}
      </div>

      <div class="checkout-grid">

        <form
          id="checkout-form"
          class="checkout-card"
        >
          <section class="final-sale-policy" aria-labelledby="checkout-final-sale-title">
            <h2 id="checkout-final-sale-title">Todas las ventas son finales.</h2>
            <p>La mayoría de los artículos son usados y se venden en el estado en que se encuentran, según las fotos y la descripción publicada. Al retirar tu compra, por favor revisá el artículo antes de llevártelo. Una vez que el artículo sale de nuestro domicilio, no aceptamos cambios, devoluciones ni reembolsos.</p>
            <p>${NO_DELIVERY_NOTICE}</p>
            ${items.some(({ product }) => product.saleMode === 'DELAYED') ? `<p>${DELAYED_PICKUP_NOTICE}</p>` : ''}
          </section>

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

          <label class="final-sale-acknowledgment">
            <input
              type="checkbox"
              name="finalSaleAcknowledged"
              value="true"
              required
            >
            <span>Entiendo que la mayoría de los artículos son usados y que todas las ventas son finales. Revisaré los artículos al retirarlos y entiendo que, una vez retirados del domicilio, no se aceptan devoluciones, cambios ni reembolsos.</span>
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
            Al continuar, los artículos quedan reservados durante 2 horas mientras
            realizás la transferencia y cargás el comprobante.
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
                Saldo pendiente
              </dt>

              <dd>
                ${formatPYG(
                  totals.future
                )}
              </dd>
            </div>
          </dl>

          ${
            totals.future > 0
              ? `<p>Pago final del saldo pendiente: ${DELAYED_FINAL_PAYMENT_WINDOW}.</p>`
              : ''
          }
        </aside>

      </div>
    </section>
  `;

  injectCheckoutStyles();

  startCheckoutLeaseCountdown();
  setupCheckoutReservationExtension();

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

        if (data.get('finalSaleAcknowledged') !== 'true') {
          errorBox.textContent = 'Debés aceptar la política de venta final antes de crear el pedido.';
          errorBox.hidden = false;
          return;
        }

        button.disabled = true;

        button.textContent =
          'Creando pedido…';

        errorBox.hidden = true;

        try {
          let checkoutId = localStorage.getItem(CHECKOUT_ID_KEY);
          if (!checkoutId) {
            checkoutId = crypto.randomUUID();
            localStorage.setItem(CHECKOUT_ID_KEY, checkoutId);
          }
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

                    checkoutId,

                    finalSaleAcknowledged: true,
                    finalSalePolicyVersion: FINAL_SALE_POLICY_VERSION,

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
          localStorage.removeItem(CHECKOUT_ID_KEY);

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

  if (order.status === 'CANCELLED') {
    main.innerHTML = `
      <section class="order-shell">
        <div class="page-heading">
          <span class="section-kicker">MI PEDIDO</span>
          <h1>Pedido cancelado</h1>
          <p>${escapeHtml(order.id)}</p>
        </div>
        <section class="checkout-card" role="status">
          <p>Este pedido fue cancelado por el vendedor. Los artículos fueron liberados y ya no están reservados para este pedido.</p>
          <p>No realices una transferencia ni subas un comprobante para este pedido. Si ya transferiste, contactá al vendedor.</p>
          <h2>Artículos del pedido cancelado</h2>
          <ul>${order.items.map(item => `<li><strong>${orderItemLabel(item)}</strong><br><span>Cantidad: ${item.quantity}</span></li>`).join('')}</ul>
          <a class="secondary-action" href="/">Volver al catálogo</a>
          <a class="secondary-action" href="https://wa.me/595972588347?text=${encodeURIComponent(`Hola, quisiera consultar por mi pedido cancelado ${order.id}.`)}" target="_blank" rel="noreferrer">Consultar por WhatsApp</a>
        </section>
      </section>
    `;
    injectCheckoutStyles();
    return;
  }

  const status =
    orderStatusLabel(
      order.status
    );

  const payments = order.payments || [];
  const paidAmount = Number(order.paidAmountPYG || 0);
  const remainingBalance = Number(order.remainingBalancePYG ?? order.totals.totalPYG);

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
                ${orderItemLabel(item)}
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
                item.futureBalancePYG > 0
                  ? `
                    ${
                      remainingBalance > 0
                        ? `
                          <span>
                            Saldo posterior:
                            ${formatPYG(
                              item.futureBalancePYG
                            )}
                          </span>

                          <span>Pago final: ${DELAYED_FINAL_PAYMENT_WINDOW}</span>
                        `
                        : ''
                    }

                    <span>Retiro: ${escapeHtml(formatPickupWindow(
                      item.pickupWindowStart,
                      item.pickupWindowEnd
                    ))}</span>

                    ${
                      remainingBalance === 0
                        ? '<span>El pago completo no adelanta la fecha de retiro.</span>'
                        : ''
                    }
                  `
                  : ''
              }
            </div>
          </article>
        `
      )
      .join('');

  const awaitingInitialPayment = order.status === 'AWAITING_INITIAL_PAYMENT';
  const awaitingFinalPayment = order.status === 'DEPOSIT_CONFIRMED' && remainingBalance > 0;
  const receiptReceived = ['RECEIPT_RECEIVED', 'FINAL_RECEIPT_RECEIVED'].includes(order.status);
  const reservationExpired = order.status === 'RESERVATION_EXPIRED' || order.reservationState === 'EXPIRED';

  if (reservationExpired) {
    main.innerHTML = `
      <section class="order-shell">
        <div class="page-heading">
          <span class="section-kicker">MI PEDIDO</span>
          <h1>${escapeHtml(order.id)}</h1>
          <p>Pedido de ${escapeHtml(order.buyer.name)}</p>
        </div>
        <section class="reservation-expired-card" role="alert">
          <span>RESERVA VENCIDA</span>
          <h2>Tu reserva venció. No realices la transferencia todavía.</h2>
          <p>Uno o más artículos ya no están disponibles para renovar este pedido completo. No cargues un comprobante ni transfieras dinero.</p>
          <p>Consultanos antes de intentar una nueva compra.</p>
        </section>
        <section class="checkout-card">
          <h2>Artículos del pedido</h2>
          ${items}
        </section>
        <a class="secondary-action" href="https://wa.me/595972588347?text=${encodeURIComponent(`Hola, quisiera consultar por la reserva vencida de mi pedido ${order.id}.`)}" target="_blank" rel="noreferrer">Consultar por WhatsApp</a>
      </section>
    `;
    injectCheckoutStyles();
    return;
  }

  const paymentHistory = payments.map((payment, index) => `
    <article class="payment-history-entry">
      <strong>Comprobante ${index + 1} · ${paymentTypeLabel(payment.type)}</strong>
      <span>${payment.amountPYG == null ? 'Pendiente de verificación' : formatPYG(payment.amountPYG)}</span>
      <span>${payment.verificationStatus === 'CONFIRMED' ? 'Confirmado' : 'Pendiente de verificación'}</span>
    </article>
  `).join('');

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

      <section class="checkout-card final-sale-policy" aria-labelledby="order-final-sale-title">
        <h2 id="order-final-sale-title">Todas las ventas son finales.</h2>
        <p>La mayoría de los artículos son usados y se venden en el estado en que se encuentran, según las fotos y la descripción publicada. Al retirar tu compra, por favor revisá el artículo antes de llevártelo. Una vez que el artículo sale de nuestro domicilio, no aceptamos cambios, devoluciones ni reembolsos.</p>
        <p>${NO_DELIVERY_NOTICE}</p>
        ${order.items.some((item) => item.saleMode === 'DELAYED') ? `<p>${DELAYED_PICKUP_NOTICE}</p>` : ''}
      </section>

      ${awaitingInitialPayment && order.holdExpiresAt ? `
        <section class="reservation-deadline-card" role="status">
          <span>RESERVA DEL PEDIDO</span>
          <strong>Reservado hasta: ${escapeHtml(formatOrderDeadline(order.holdExpiresAt))}</strong>
          <p>Los artículos están reservados mientras completás la transferencia y enviás el comprobante.</p>
          ${order.reservationRenewed ? '<p><strong>Tu reserva fue renovada por 2 horas.</strong></p>' : ''}
        </section>
      ` : ''}

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
                Pagado
              </dt>

              <dd>
                ${formatPYG(
                  paidAmount
                )}
              </dd>
            </div>

            <div>
              <dt>
                Saldo pendiente
              </dt>

              <dd>
                ${formatPYG(
                  remainingBalance
                )}
              </dd>
            </div>
          </dl>

          ${
            awaitingInitialPayment || awaitingFinalPayment
              ? renderBankSection(
                  order,
                  access,
                  awaitingFinalPayment
                )
              : ''
          }

          ${paymentHistory ? `<section class="payment-history"><h3>Historial de pagos</h3>${paymentHistory}</section>` : ''}

          ${
            receiptReceived
              ? `
                <div class="pickup-confirm">
                  <strong>
                    ${order.status === 'FINAL_RECEIPT_RECEIVED' ? 'Comprobante del saldo recibido' : 'Comprobante recibido'}
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

      <section class="checkout-card" id="pickup-scheduler" aria-live="polite">
        <h2>Retiro</h2>
        <p>Cargando horarios de retiro…</p>
      </section>

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

  setupPickupScheduler(order, access).then(() => {
    if (window.location.hash === '#pickup-scheduler') {
      document.getElementById('pickup-scheduler')?.scrollIntoView({ block: 'start' });
    }
  });

  if (awaitingInitialPayment || awaitingFinalPayment) {
    setupBankAliasCopy(order.bank?.alias);
    setupReceiptUpload(
      order,
      access
    );
  }
}

async function setupPickupScheduler(order, access) {
  const target = document.getElementById('pickup-scheduler');
  if (!target) return;
  try {
    const query = new URLSearchParams({ id: order.id, access });
    const response = await fetch(`/api/orders/pickup?${query}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los horarios.');
    const appointment = data.appointment?.status === 'SCHEDULED' ? data.appointment : null;
    const current = appointment?.slotKey ? appointment.slotKey.replace('|', ' · ') : '';
    target.innerHTML = `<h2>Retiro</h2>
      <div class="pickup-policy-reminder">
        <strong>Antes de retirarte con los artículos, revisalos y asegurate de estar conforme. Una vez retirados del domicilio, la venta es final.</strong>
        <span>${NO_DELIVERY_NOTICE}</span>
        ${order.items.some((item) => item.saleMode === 'DELAYED') ? `<span>${DELAYED_PICKUP_NOTICE}</span>` : ''}
      </div>
      ${appointment ? `<p><strong>Horario confirmado:</strong> ${escapeHtml(current)}</p>` : ''}
      ${data.eligible ? `<form id="pickup-scheduler-form">
        <label for="pickup-slot">${appointment ? 'Cambiar horario' : 'Elegí un horario'}</label>
        <select id="pickup-slot" name="slotKey" required>
          <option value="">Seleccioná fecha y horario</option>
          ${data.slots.filter(slot => slot.remaining > 0 || slot.selected).map(slot =>
            `<option value="${escapeHtml(slot.key)}">${escapeHtml(slot.key.replace('|', ' · '))} · ${slot.remaining} lugar(es)</option>`).join('')}
        </select>
        <button class="primary-action" type="submit">${appointment ? 'Cambiar retiro' : 'Agendar retiro'}</button>
        <p class="form-error" id="pickup-scheduler-error" role="alert" hidden></p>
      </form>` : `<p>${order.status === 'CANCELLED' ? 'Pedido cancelado.' : 'Podrás agendar cuando el vendedor confirme el pago total.'}</p>`}`;
    target.querySelector('form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = target.querySelector('button[type="submit"]');
      const error = document.getElementById('pickup-scheduler-error');
      button.disabled = true;
      error.hidden = true;
      try {
        const saved = await fetch('/api/orders/pickup', { method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId: order.id, access,
            slotKey: document.getElementById('pickup-slot').value }) });
        const result = await saved.json();
        if (!saved.ok) throw new Error(result.error || 'No se pudo agendar el retiro.');
        await setupPickupScheduler(order, access);
      } catch (problem) {
        error.textContent = problem.message;
        error.hidden = false;
        button.disabled = false;
      }
    });
  } catch (error) {
    target.innerHTML = `<h2>Retiro</h2><p>${escapeHtml(error.message)}</p>`;
  }
}


function renderBankSection(
  order,
  access,
  finalPayment = false
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
      <h3>${finalPayment ? 'Pago del saldo' : 'Datos para transferencia'}</h3>

      ${finalPayment ? `
        <dl>
          <div><dt>Total del pedido</dt><dd>${formatPYG(order.totals.totalPYG)}</dd></div>
          <div><dt>Pagado</dt><dd>${formatPYG(order.paidAmountPYG)}</dd></div>
          <div><dt>Saldo pendiente</dt><dd>${formatPYG(order.remainingBalancePYG)}</dd></div>
        </dl>
      ` : ''}

      <dl>
        <div>
          <dt>Titular</dt>
          <dd>
            ${escapeHtml(
              order.bank.accountName
            )}
          </dd>
        </div>

        <div>
          <dt>CI</dt>
          <dd>
            ${escapeHtml(
              order.bank.identification
            )}
          </dd>
        </div>

        <div>
          <dt>Entidad</dt>
          <dd>
            ${escapeHtml(
              order.bank.bankName
            )}
          </dd>
        </div>

        <div>
          <dt>N° de cuenta</dt>
          <dd>
            ${escapeHtml(
              order.bank.accountNumber
            )}
          </dd>
        </div>

        <div>
          <dt>Moneda</dt>
          <dd>
            ${escapeHtml(
              order.bank.currency
            )}
          </dd>
        </div>
      </dl>

      <div class="bank-alias">
        <div>
          <span>Alias</span>
          <input
            id="bank-alias-value"
            type="text"
            readonly
            value="${escapeHtml(order.bank.alias)}"
            aria-label="Alias bancario"
          >
        </div>
        <button
          class="secondary-action"
          id="copy-bank-alias"
          type="button"
        >Copiar alias</button>
        <small id="bank-alias-copy-status" role="status" aria-live="polite"></small>
      </div>

      ${finalPayment
        ? `<p>Transferí el saldo pendiente de <strong>${formatPYG(order.remainingBalancePYG)}</strong>.</p>`
        : Number(order.totals.futureBalancePYG || 0) > 0
          ? `<p>Podés transferir la seña de <strong>${formatPYG(order.totals.dueNowPYG)}</strong> o el pago total de <strong>${formatPYG(order.totals.totalPYG)}</strong>. El vendedor registrará el importe verificado.</p>`
          : `<p>Transferí exactamente <strong>${formatPYG(order.totals.totalPYG)}</strong>.</p>`
      }

      <form
        id="receipt-form"
        class="receipt-upload-highlight"
        aria-labelledby="receipt-upload-heading"
      >
        <h3 id="receipt-upload-heading">${finalPayment ? 'Después de transferir el saldo, subí tu comprobante aquí' : 'Después de transferir, subí tu comprobante aquí'}</h3>
        <p>Necesitamos que cargues el comprobante en esta página para poder verificar tu pago. No lo envíes solamente por WhatsApp.</p>
        <label>
          <span>
            Elegí el archivo de tu comprobante
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
        <p class="receipt-verification-note">Subir el comprobante no confirma el pago. El vendedor debe verificar que los fondos hayan ingresado.</p>
      </form>
    </div>
  `;
}


function setupBankAliasCopy(alias) {
  const button =
    document.getElementById('copy-bank-alias');

  if (!button || !alias) {
    return;
  }

  button.addEventListener('click', async function () {
    const status =
      document.getElementById('bank-alias-copy-status');

    try {
      await navigator.clipboard.writeText(alias);
      status.textContent = 'Alias copiado';
    } catch {
      const aliasValue =
        document.getElementById('bank-alias-value');

      aliasValue.focus();
      aliasValue.select();
      status.textContent = 'Alias seleccionado; copiálo.';
    }
  });
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
    CANCELLED: 'Pedido cancelado',
    RESERVATION_EXPIRED: 'Reserva vencida',
    AWAITING_INITIAL_PAYMENT:
      'Esperando transferencia',

    RECEIPT_RECEIVED:
      'Comprobante recibido',

    FINAL_RECEIPT_RECEIVED:
      'Comprobante del saldo recibido',

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


function formatOrderDeadline(value) {
  return new Date(Number(value)).toLocaleString('es-PY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}


function paymentTypeLabel(type) {
  return ({
    DEPOSIT: 'Seña',
    FINAL: 'Pago del saldo',
    FULL: 'Pago total',
    PENDING: 'Pendiente de clasificación',
  })[type] || type || '';
}


function orderItemLabel(item) {
  const number = item.itemNumber == null
    ? ''
    : `Item ${String(item.itemNumber).padStart(3, '0')} · `;
  return `${escapeHtml(number)}${escapeHtml(item.title)}`;
}


function startCheckoutLeaseCountdown() {
  const target = document.querySelector('#checkout-lease-countdown strong');
  const wrapper = document.getElementById('checkout-lease-countdown');
  if (!target || !wrapper) return;
  const expiresAt = Number(wrapper.dataset.expiresAt || 0);
  clearInterval(startCheckoutLeaseCountdown.timer);
  const update = () => {
    const currentExpiration = Number(wrapper.dataset.expiresAt || expiresAt);
    const remaining = currentExpiration - Date.now();
    const extension = document.getElementById('checkout-cart-extension');
    if (remaining <= 0) {
      target.textContent = 'vencida';
      const button = document.querySelector('#checkout-form button[type="submit"]');
      if (button) button.disabled = true;
      wrapper.textContent = 'La reserva temporal venció y este artículo volvió a estar disponible.';
      clearInterval(startCheckoutLeaseCountdown.timer);
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    target.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (extension && !extension.dataset.used && remaining <= 10 * 60 * 1000) extension.hidden = false;
  };
  update();
  startCheckoutLeaseCountdown.timer = setInterval(update, 1000);
}


function setupCheckoutReservationExtension() {
  const button = document.getElementById('extend-checkout-reservation');
  if (!button) return;
  button.addEventListener('click', async function () {
    button.disabled = true;
    try {
      const response = await fetch('/api/cart/reservation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'extend' }),
      });
      const result = await response.json();
      if (!response.ok || !result.lease) throw new Error(result.error || 'No se pudo extender la reserva.');
      if (typeof setStaticCartFromLease === 'function') setStaticCartFromLease(result.lease);
      const wrapper = document.getElementById('checkout-lease-countdown');
      if (wrapper) wrapper.dataset.expiresAt = String(result.lease.expiresAt);
      const extension = document.getElementById('checkout-cart-extension');
      if (extension) {
        extension.dataset.used = 'true';
        extension.hidden = false;
        extension.innerHTML = '<strong>Reserva extendida</strong><span>Tenés 20 minutos adicionales para terminar tu compra.</span>';
      }
      startCheckoutLeaseCountdown();
    } catch (error) {
      button.disabled = false;
      const errorBox = document.getElementById('checkout-error');
      if (errorBox) {
        errorBox.textContent = error instanceof Error ? error.message : 'No se pudo extender la reserva.';
        errorBox.hidden = false;
      }
    }
  });
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

    .final-sale-policy,
    .pickup-policy-reminder {
      display: grid;
      gap: 9px;
      border: 2px solid var(--clay);
      border-radius: 12px;
      background: #fff8f4;
      padding: 18px;
    }

    .final-sale-policy h2,
    .final-sale-policy p {
      margin: 0;
    }

    .final-sale-acknowledgment {
      grid-template-columns: 22px 1fr;
      align-items: start;
      gap: 12px !important;
      border: 2px solid var(--forest);
      border-radius: 12px;
      background: #f3faf6;
      padding: 16px;
      font-weight: 700;
      line-height: 1.5;
    }

    .checkout-card .final-sale-acknowledgment input {
      width: 20px;
      min-height: 20px;
      margin: 2px 0 0;
      padding: 0;
    }

    .pickup-policy-reminder span {
      display: block;
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

    #receipt-form.receipt-upload-highlight {
      margin-top: 20px;
      padding: 22px;
      border: 2px solid var(--forest);
      border-radius: 14px;
      background: #edf5ef;
      box-shadow: 0 5px 18px rgba(23, 62, 46, .10);
    }

    #receipt-form h3 {
      margin: 0;
      font-size: 1.4rem;
      line-height: 1.3;
      color: var(--forest-dark);
    }

    #receipt-form p { margin: 0; line-height: 1.5; }
    #receipt-form label > span { font-weight: 700; }
    #receipt-form input[type="file"] { border: 2px solid var(--forest); }
    #receipt-form input[type="file"]::file-selector-button {
      padding: 10px 12px;
      margin-right: 10px;
      border: 0;
      border-radius: 6px;
      background: var(--forest);
      color: white;
      font-weight: 700;
      cursor: pointer;
    }
    #receipt-form .primary-action { width: 100%; min-height: 50px; font-weight: 700; }
    #receipt-form .receipt-verification-note { font-size: .9rem; }

    .payment-history {
      display: grid;
      gap: 10px;
      margin-top: 18px;
    }

    .payment-history-entry {
      display: grid;
      gap: 4px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: white;
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

    .reservation-deadline-card,
    .reservation-expired-card {
      display: grid;
      gap: 8px;
      margin: 0 0 28px;
      padding: 22px;
      border-radius: 14px;
    }

    .reservation-deadline-card {
      border: 2px solid var(--forest);
      background: #edf5ef;
    }

    .reservation-deadline-card > strong {
      font-size: 1.3rem;
    }

    .reservation-deadline-card p,
    .reservation-expired-card p,
    .reservation-expired-card h2 {
      margin: 0;
    }

    .reservation-expired-card {
      border: 3px solid #9c2f24;
      background: #fff0ed;
      color: #6f1f18;
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

    .bank-alias {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px 16px;
      padding: 14px;
      border: 1px solid var(--forest);
      border-radius: 10px;
      background: #f1f7f3;
    }

    .bank-alias > div {
      display: grid;
      gap: 3px;
      margin-right: auto;
    }

    .bank-alias > div span {
      color: var(--muted);
      font-size: .82rem;
    }

    .bank-alias > div input {
      min-width: min(22rem, 100%);
      min-height: 42px;
      padding: 6px 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--forest-dark);
      font-size: 1.15rem;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    .bank-alias button {
      min-height: 42px;
      cursor: pointer;
    }

    .bank-alias small {
      flex-basis: 100%;
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
