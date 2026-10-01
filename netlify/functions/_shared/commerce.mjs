import { catalogBatchProducts } from './volume2-public.mjs';
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
    endDate: '2026-12-12',
    mode: 'OPEN_DAY',
  },
});


function ordersStore() {
  return getStore({
    name: 'mudanza-orders',
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

export function cartSessionIdFromRequest(request) {
  const cookie = request.headers.get('cookie') || '';
  const value = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('psych_cart_session='))?.slice('psych_cart_session='.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '') ? value : null;
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

  const currency =
    process.env.BANK_CURRENCY || '';

  const alias =
    process.env.BANK_ALIAS || '';

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
    currency,
    alias,
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


function parseEmbeddedCatalog(html) {
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

  return products;
}


export async function loadBaseCatalog(origin) {
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

  const staticProducts =
    parseEmbeddedCatalog(html);

  const merchandisingProducts =
    catalogBatchProducts();

  const byId = new Map();

  for (const product of [
    ...staticProducts,
    ...merchandisingProducts,
  ]) {
    if (product?.id) {
      byId.set(product.id, product);
    }
  }

  return [...byId.values()]
    .sort(
      (a, b) =>
        Number(a.itemNumber) -
        Number(b.itemNumber)
    );
}


export async function loadCatalog(origin) {
  const products =
    await loadBaseCatalog(origin);

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

  const committedInventory = await readCommittedInventory();

  return products
    .map(
      (product) => {
        const source = applyProductOverride(
          product,
          overrideById.get(product.id)
        );
        const inventory = committedInventory.get(product.id);
        if (!inventory) return source;
        const remaining = Math.max(0,
          Math.min(Number(source.quantityRemaining ?? source.quantityTotal ?? 1), inventory.capacity)
            - inventory.committed_quantity);
        return {
          ...source,
          description: inventory.committed_quantity > 0 && typeof source.description === 'string'
            ? source.description.replace(/\bHay \d+ unidades disponibles\b/i,
              remaining > 0 ? `Hay ${remaining} unidades disponibles` : 'No quedan unidades disponibles')
            : source.description,
          quantityRemaining: remaining,
          quantitySold: Math.max(Number(source.quantitySold || 0),
            Number(source.quantityTotal ?? 1) - remaining),
          status: source.status === 'AVAILABLE' && remaining === 0 ? 'SOLD' : source.status,
        };
      }
    )
    .sort(
      (a, b) =>
        Number(a.itemNumber) -
        Number(b.itemNumber)
    );
}

export {
  claimCartLease, updateCartLease, releaseCartLease, getCartLeaseStatus,
  transitionCartLeaseToOrder, getCartCheckoutAttempt, recordOrderReceipt,
  commitInventoryHold, updateProductCapacity,
} from './inventory-database.mjs';
import { listOrderSnapshots, readCommittedInventory } from './inventory-database.mjs';
import { recoverOrderBlob, readRecoverableOrder } from './order-recovery.mjs';

export async function writeNewOrder(order) {
  try {
    const recovered = await recoverOrderBlob(order.id);
    if (!recovered) throw new Error('No encontramos la reserva del pedido.');
    return recovered;
  } catch (error) {
    const failure = new Error('El pedido quedó reservado y se puede recuperar reintentando la compra.');
    failure.status = 503;
    throw failure;
  }
}

export async function getOrder(orderId) { return readRecoverableOrder(orderId); }

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

  const snapshots = await listOrderSnapshots();
  const byId = new Map(orders.map(order => [order.id, order]));
  for (const snapshot of snapshots) byId.set(snapshot.id, snapshot);
  orders.splice(0, orders.length, ...byId.values());

  orders.sort(
    (a, b) =>
      Number(b.createdAt || 0) -
      Number(a.createdAt || 0)
  );

  return orders;
}
