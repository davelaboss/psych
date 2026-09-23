import { createHash, randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const SALES_OPEN_AT =
  Date.parse('2026-10-01T00:00:00-03:00');

export const SALES_CLOSE_AT =
  Date.parse('2026-12-01T00:00:00-03:00');

export const INITIAL_HOLD_MS =
  45 * 60 * 1000;

export const PICKUP_RULES = Object.freeze({
  timezone: 'America/Asuncion',

  defaultCapacityPerWindow: 4,

  mainPickup: {
    startDate: '2026-10-01',
    endDate: '2026-12-08',

    monday: [
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ],

    tuesday: [
      ['08:00', '12:00'],
      ['13:00', '16:00'],
    ],

    wednesday: [
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ],

    thursday: [
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ],

    friday: [
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ],

    saturday: [
      ['14:00', '17:00'],
    ],

    sunday: [],
  },

  exceptions: {
    '2026-12-08': [
      ['13:00', '17:00'],
    ],
  },

  delayedFinalPayment: {
    startDate: '2026-12-01',
    endDate: '2026-12-08',
  },

  delayedPickup: {
    startDate: '2026-12-09',
    endDate: '2026-12-13',
    mode: 'OPEN_DAY',
  },
});


function ordersStore() {
  return getStore({
    name: 'mudanza-orders',
    consistency: 'strong',
  });
}


function inventoryStore() {
  return getStore({
    name: 'mudanza-inventory',
    consistency: 'strong',
  });
}


function productOverrideStore() {
  return getStore({
    name: 'mudanza-product-overrides',
    consistency: 'strong',
  });
}


export function productMediaStore() {
  return getStore({
    name: 'mudanza-product-media',
    consistency: 'strong',
  });
}


export async function getProductOverride(productId) {
  return productOverrideStore().get(
    `product:${productId}`,
    {
      type: 'json',
      consistency: 'strong',
    }
  );
}


export async function saveProductOverride(productId, override) {
  const saved = {
    ...override,
    productId,
    updatedAt: Date.now(),
  };

  await productOverrideStore().setJSON(
    `product:${productId}`,
    saved
  );

  return saved;
}


export async function listProductOverrides() {
  const store = productOverrideStore();
  const result = await store.list({
    prefix: 'product:',
  });

  const overrides = [];

  for (const blob of result.blobs || []) {
    const value = await store.get(
      blob.key,
      {
        type: 'json',
        consistency: 'strong',
      }
    );

    if (value) {
      overrides.push(value);
    }
  }

  return overrides;
}


function applyProductOverride(product, override) {
  if (!override) {
    return product;
  }

  const next = {
    ...product,
    ...(override.publicFields || {}),
  };

  if (
    Object.prototype.hasOwnProperty.call(
      override,
      'images'
    )
  ) {
    next.images = Array.isArray(override.images)
      ? override.images
      : [];
  }

  return next;
}


export function receiptStore() {
  return getStore({
    name: 'mudanza-receipts',
    consistency: 'strong',
  });
}


export function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  });
}


export function randomAccessToken() {
  return randomBytes(32).toString('base64url');
}


export function hashAccessToken(token) {
  return createHash('sha256')
    .update(String(token || ''))
    .digest('hex');
}


export function makeOrderId() {
  const suffix = randomBytes(4)
    .toString('hex')
    .toUpperCase();

  return `VM-2026-${suffix}`;
}


export function bankInstructions() {
  const bankName =
    process.env.BANK_NAME || '';

  const accountName =
    process.env.BANK_ACCOUNT_NAME || '';

  const accountNumber =
    process.env.BANK_ACCOUNT_NUMBER || '';

  const identification =
    process.env.BANK_IDENTIFICATION || '';

  const configured =
    Boolean(
      bankName &&
      accountName &&
      accountNumber
    );

  return {
    configured,
    bankName,
    accountName,
    accountNumber,
    identification,
  };
}


export function isLocalRequest(request) {
  const hostname =
    new URL(request.url).hostname;

  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  );
}


export function salesAreOpen(request) {
  if (isLocalRequest(request)) {
    return true;
  }

  const now = Date.now();

  return (
    now >= SALES_OPEN_AT &&
    now < SALES_CLOSE_AT
  );
}


export async function loadCatalog(origin) {
  const response = await fetch(
    new URL('/', origin),
    {
      headers: {
        accept: 'text/html',
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      'No se pudo cargar el catálogo.'
    );
  }

  const html = await response.text();

  const marker = '\\"products\\":[';
  const markerIndex = html.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(
      'No se encontró el inventario del sitio.'
    );
  }

  const start =
    markerIndex + marker.length - 1;

  let depth = 0;
  let end = -1;
  let inString = false;

  for (let i = start; i < html.length; i += 1) {
    if (
      html[i] === '\\' &&
      html[i + 1] === '"'
    ) {
      inString = !inString;
      i += 1;
      continue;
    }

    if (inString) {
      continue;
    }

    if (html[i] === '[') {
      depth += 1;
    }

    if (html[i] === ']') {
      depth -= 1;

      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error(
      'El inventario embebido está incompleto.'
    );
  }

  const escapedJson =
    html.slice(start, end + 1);

  const normalizedJson =
    escapedJson.replace(/\\"/g, '"');

  const products =
    JSON.parse(normalizedJson);

  if (!Array.isArray(products)) {
    throw new Error(
      'El inventario no tiene el formato esperado.'
    );
  }

  const overrides =
    await listProductOverrides();

  const overrideById =
    new Map(
      overrides.map(
        (override) => [
          override.productId,
          override,
        ]
      )
    );

  return products.map(
    (product) =>
      applyProductOverride(
        product,
        overrideById.get(product.id)
      )
  );
}


// File: netlify/functions/_shared/commerce.mjs

async function getActiveHolds() {
  const store = inventoryStore();

  const result = await store.list({
    prefix: 'hold:',
  });

  const holds = [];

  for (const blob of result.blobs) {
    const hold = await store.get(blob.key, {
      type: 'json',
      consistency: 'strong',
    });

    if (!hold) {
      continue;
    }

    if (
      !hold.locked &&
      Number(hold.expiresAt || 0) <= Date.now()
    ) {
      await store.delete(blob.key);
      continue;
    }

    holds.push(hold);
  }

  return holds;
}


function heldQuantity(
  holds,
  productId,
  excludeOrderId = null
) {
  let quantity = 0;

  for (const hold of holds) {
    if (hold.orderId === excludeOrderId) {
      continue;
    }

    for (const item of hold.items || []) {
      if (item.productId === productId) {
        quantity += Number(item.quantity || 0);
      }
    }
  }

  return quantity;
}


export async function reserveInventoryHold({
  orderId,
  items,
  availability,
  expiresAt,
}) {
  const store = inventoryStore();

  const holds = await getActiveHolds();

  for (const item of items) {
    const sourceQuantity =
      Number(availability[item.productId] || 0);

    const held =
  heldQuantity(
    holds,
    item.productId,
    orderId
  );

const committed =
  await committedQuantity(
    item.productId
  );

const available =
  sourceQuantity -
  held -
  committed;

    if (available < item.quantity) {
      const error = new Error(
        'Uno de los artículos ya no tiene la cantidad solicitada disponible.'
      );

      error.status = 409;
      throw error;
    }
  }

  const hold = {
    orderId,
    createdAt: Date.now(),
    expiresAt,
    locked: false,
    items,
  };

  await store.setJSON(
    `hold:${orderId}`,
    hold
  );
}


export async function releaseInventoryHold(
  orderId
) {
  await inventoryStore().delete(
    `hold:${orderId}`
  );
}


export async function lockInventoryHold(
  orderId
) {
  const store = inventoryStore();

  const key = `hold:${orderId}`;

  const hold = await store.get(
    key,
    {
      type: 'json',
      consistency: 'strong',
    }
  );

  if (!hold) {
    return false;
  }

  if (
    !hold.locked &&
    Number(hold.expiresAt || 0) <= Date.now()
  ) {
    await store.delete(key);
    return false;
  }

  hold.locked = true;
  hold.expiresAt = null;

  await store.setJSON(
    key,
    hold
  );

  return true;
}


export async function writeNewOrder(order) {
  const result =
    await ordersStore().setJSON(
      order.id,
      order,
      {
        onlyIfNew: true,
      }
    );

  if (!result.modified) {
    throw new Error(
      'No se pudo crear el número de pedido.'
    );
  }
}


export async function getOrder(orderId) {
  return ordersStore().get(
    orderId,
    {
      type: 'json',
      consistency: 'strong',
    }
  );
}


export async function getAuthorizedOrder(
  orderId,
  accessToken
) {
  const order =
    await getOrder(orderId);

  if (!order) {
    return null;
  }

  if (
    order.accessTokenHash !==
    hashAccessToken(accessToken)
  ) {
    return null;
  }

  return order;
}


export async function mutateOrder(
  orderId,
  mutator
) {
  const store = ordersStore();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const entry =
      await store.getWithMetadata(
        orderId,
        {
          type: 'json',
          consistency: 'strong',
        }
      );

    if (!entry) {
      return null;
    }

    const order =
      structuredClone(entry.data);

    const updated =
      await mutator(order);

    const result =
      await store.setJSON(
        orderId,
        updated,
        {
          onlyIfMatch: entry.etag,
        }
      );

    if (result.modified) {
      return updated;
    }
  }

  throw new Error(
    'El pedido cambió mientras intentábamos actualizarlo.'
  );
}


export function publicOrder(order) {
  return {
    id: order.id,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,

    status: order.status,

    buyer: {
      name: order.buyer.name,
      phone: order.buyer.phone,
      email: order.buyer.email || '',
    },

    items: order.items,

    totals: order.totals,

    holdExpiresAt:
      order.holdExpiresAt || null,

    receipt: order.receipt
      ? {
          fileName:
            order.receipt.fileName,

          contentType:
            order.receipt.contentType,

          uploadedAt:
            order.receipt.uploadedAt,
        }
      : null,

    pickup: order.pickup || null,

    bank: bankInstructions(),
  };
}

export function adminAuthorized(request) {
  const expected = String(
    process.env.ADMIN_TOKEN || ''
  );

  const provided = String(
    request.headers.get('x-admin-token') || ''
  );

  return Boolean(
    expected &&
    provided &&
    expected === provided
  );
}


export async function listOrders() {
  const store = ordersStore();

  const result = await store.list();

  const orders = [];

  for (const blob of result.blobs) {
    const order = await store.get(
      blob.key,
      {
        type: 'json',
        consistency: 'strong',
      }
    );

    if (order) {
      orders.push(order);
    }
  }

  orders.sort(
    (a, b) =>
      Number(b.createdAt || 0) -
      Number(a.createdAt || 0)
  );

  return orders;
}


async function committedQuantity(productId) {
  const record = await inventoryStore().get(
    `committed:${productId}`,
    {
      type: 'json',
      consistency: 'strong',
    }
  );

  return Number(
    record?.quantity || 0
  );
}


export async function commitInventoryHold(
  orderId
) {
  const store = inventoryStore();

  const key = `hold:${orderId}`;

  const hold = await store.get(
    key,
    {
      type: 'json',
      consistency: 'strong',
    }
  );

  if (!hold) {
    return false;
  }

  for (const item of hold.items || []) {
    const committed =
      await committedQuantity(
        item.productId
      );

    await store.setJSON(
      `committed:${item.productId}`,
      {
        quantity:
          committed +
          Number(item.quantity || 0),

        updatedAt: Date.now(),
      }
    );
  }

  await store.delete(key);

  return true;
}