import {
  cartSessionIdFromRequest,
  getCartCheckoutAttempt,
  getOrder,
  hashAccessToken,
  jsonResponse,
  loadCatalog,
  makeOrderId,
  publicOrder,
  salesAreOpen,
  transitionCartLeaseToOrder,
  writeNewOrder,
} from './_shared/commerce.mjs';
import { orderAccessToken } from './_shared/order-access.mjs';

const FINAL_SALE_POLICY_VERSION = '2026-10-02-v1';


export default async function handler(request) {
  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  try {
    if (!salesAreOpen(request)) {
      return jsonResponse(
        {
          error:
            'Las ventas abren el 1 de octubre de 2026 y cierran al finalizar el 30 de noviembre de 2026.',
        },
        403
      );
    }

    const body = await request.json();

    if (body?.finalSaleAcknowledged !== true ||
        body?.finalSalePolicyVersion !== FINAL_SALE_POLICY_VERSION) {
      return jsonResponse(
        { error: 'Debés aceptar la política de venta final antes de crear el pedido.' },
        400
      );
    }

    const name =
      String(body?.buyer?.name || '').trim();

    const phone =
      String(body?.buyer?.phone || '')
        .replace(/[^\d+]/g, '')
        .trim();

    const email =
      String(body?.buyer?.email || '')
        .trim()
        .toLowerCase();
    const cartSessionId = cartSessionIdFromRequest(request) || '';
    const checkoutId = String(body?.checkoutId || '');

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cartSessionId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutId)) {
      throw new Error('No encontramos la reserva de este carrito. Volvé al catálogo y agregá los artículos nuevamente.');
    }

    if (name.length < 2) {
      throw new Error(
        'Ingresá tu nombre.'
      );
    }

    if (
      phone.replace(/\D/g, '').length < 8
    ) {
      throw new Error(
        'Ingresá un número de WhatsApp válido.'
      );
    }

    const accessTokenFor = (orderId) => orderAccessToken(cartSessionId, orderId);
    const existingAttempt = await getCartCheckoutAttempt(cartSessionId, checkoutId, body.items);
    if (existingAttempt) {
      if (existingAttempt.expiresAt != null && existingAttempt.expiresAt <= Date.now()
        && existingAttempt.orderSnapshot.status === 'AWAITING_INITIAL_PAYMENT') {
        const error = new Error('La reserva temporal venció y este artículo volvió a estar disponible.');
        error.status = 409;
        throw error;
      }
      const recovered = await writeNewOrder(existingAttempt.orderSnapshot);
      return jsonResponse({ ok: true, order: publicOrder(recovered), accessToken: accessTokenFor(existingAttempt.orderId) });
    }

    if (!Array.isArray(body.items)) {
      throw new Error(
        'El carrito está vacío.'
      );
    }

    const requested = new Map();

    for (const item of body.items) {
      const productId =
        String(item.productId || '');

      const quantity =
        Math.max(
          1,
          Math.floor(
            Number(item.quantity || 1)
          )
        );

      if (!productId) {
        continue;
      }

      requested.set(
        productId,
        (requested.get(productId) || 0) +
          quantity
      );
    }

    if (
      requested.size === 0 ||
      requested.size > 30
    ) {
      throw new Error(
        'El carrito no tiene una selección válida.'
      );
    }

    const origin =
      new URL(request.url).origin;

    const catalog =
      await loadCatalog(origin);

    const byId =
      new Map(
        catalog.map(
          (product) => [
            product.id,
            product,
          ]
        )
      );

    const orderItems = [];
    const holdItems = [];
    const availability = {};

    let total = 0;
    let dueNow = 0;
    let futureBalance = 0;

    for (
      const [productId, quantity]
      of requested.entries()
    ) {
      const product =
        byId.get(productId);

      if (!product) {
        throw new Error(
          'Uno de los artículos ya no existe.'
        );
      }

      if (
        product.status !== 'AVAILABLE'
      ) {
        const error = new Error(
          `${product.title} ya no está disponible.`
        );

        error.status = 409;
        throw error;
      }

      const remaining =
        Math.max(
          0,
          Number(
            product.quantityRemaining || 0
          )
        );

      if (
        quantity > remaining
      ) {
        const error = new Error(
          `Ya no hay suficiente cantidad disponible de ${product.title}.`
        );

        error.status = 409;
        throw error;
      }

      const unitPrice =
        Number(
          product.askingPricePYG || 0
        );

      const unitDueNow =
        product.saleMode === 'DELAYED'
          ? Math.round(
              unitPrice *
                (
                  Number(
                    product.depositPercent ||
                    0
                  ) / 100
                )
            )
          : unitPrice;

      const itemTotal =
        unitPrice * quantity;

      const itemDueNow =
        unitDueNow * quantity;

      const itemFutureBalance =
        itemTotal - itemDueNow;

      total += itemTotal;
      dueNow += itemDueNow;
      futureBalance +=
        itemFutureBalance;

      orderItems.push({
        productId: product.id,
        itemNumber:
          product.itemNumber,

        slug: product.slug,
        title: product.title,

        image:
          product.images?.[0] || '',

        quantity,

        unitPricePYG:
          unitPrice,

        saleMode:
          product.saleMode,

        depositPercent:
          Number(
            product.depositPercent || 0
          ),

        dueNowPYG:
          itemDueNow,

        futureBalancePYG:
          itemFutureBalance,

        pickupAvailableDate:
          product.pickupAvailableDate ||
          null,

        pickupWindowStart:
          product.pickupWindowStart ||
          null,

        pickupWindowEnd:
          product.pickupWindowEnd ||
          null,
      });

      holdItems.push({
        productId:
          product.id,

        quantity,
      });

      availability[product.id] =
        remaining;
    }

    let orderId =
      makeOrderId();

    while (
      await getOrder(orderId)
    ) {
      orderId =
        makeOrderId();
    }

    const now = Date.now();

    const accessToken = accessTokenFor(orderId);
    const orderSnapshot = {
      buyer: { name, phone, email },
      id: orderId,

      accessTokenHash:
        hashAccessToken(accessToken),

      createdAt: now,
      updatedAt: now,

      status:
        'AWAITING_INITIAL_PAYMENT',

      items: orderItems,

      totals: {
        totalPYG: total,
        dueNowPYG: dueNow,
        futureBalancePYG:
          futureBalance,
      },

      receipt: null,
      payments: [],
      paidAmountPYG: 0,
      remainingBalancePYG: total,
      pickup: null,
      finalSaleAcknowledgment: {
        policyVersion: FINAL_SALE_POLICY_VERSION,
        acknowledgedAt: now,
      },
    };

    const attempt = await transitionCartLeaseToOrder({
      cartSessionId,
      checkoutId,
      orderId,
      items: holdItems,
      availability,
      orderSnapshot,
    });
    const finalAccessToken = accessTokenFor(attempt.orderId);
    const order = await writeNewOrder(attempt.orderSnapshot);

    return jsonResponse(
      {
        ok: true,

        order:
          publicOrder(order),

        accessToken: finalAccessToken,
      },
      201
    );
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo crear el pedido.',
      },
      Number(error?.status || 400)
    );
  }
}
