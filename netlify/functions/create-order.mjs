import {
  INITIAL_HOLD_MS,
  getOrder,
  hashAccessToken,
  jsonResponse,
  loadCatalog,
  makeOrderId,
  publicOrder,
  randomAccessToken,
  releaseInventoryHold,
  reserveInventoryHold,
  salesAreOpen,
  writeNewOrder,
} from './_shared/commerce.mjs';


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

    const accessToken =
      randomAccessToken();

    let orderId =
      makeOrderId();

    while (
      await getOrder(orderId)
    ) {
      orderId =
        makeOrderId();
    }

    const now = Date.now();

    const holdExpiresAt =
      now + INITIAL_HOLD_MS;

    await reserveInventoryHold({
      orderId,
      items: holdItems,
      availability,
      expiresAt: holdExpiresAt,
    });

    const order = {
      id: orderId,

      accessTokenHash:
        hashAccessToken(accessToken),

      createdAt: now,
      updatedAt: now,

      status:
        'AWAITING_INITIAL_PAYMENT',

      buyer: {
        name,
        phone,
        email,
      },

      items: orderItems,

      totals: {
        totalPYG: total,
        dueNowPYG: dueNow,
        futureBalancePYG:
          futureBalance,
      },

      holdExpiresAt,

      receipt: null,
      pickup: null,
    };

    try {
      await writeNewOrder(order);
    } catch (error) {
      await releaseInventoryHold(
        orderId
      );

      throw error;
    }

    return jsonResponse(
      {
        ok: true,

        order:
          publicOrder(order),

        accessToken,
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