import { createHash } from 'node:crypto';
import { database } from './inventory-database.mjs';
import { projectPublicCatalog } from './commerce.mjs';

export const ANALYTICS_EVENT_TYPES = Object.freeze([
  'CATALOG_VISIT',
  'CATEGORY_SELECT',
  'SEARCH',
  'FILTER_APPLY',
  'PRODUCT_VIEW',
  'ADD_TO_CART',
]);

export const ANALYTICS_RETENTION_DAYS = 90;
export const LOW_INTEREST_MINIMUM_HOURS = 24;

const PUBLIC_EVENT_TYPES = new Set(ANALYTICS_EVENT_TYPES.filter((type) => type !== 'ADD_TO_CART'));
const EVENT_TYPES = new Set(ANALYTICS_EVENT_TYPES);
const CAMPAIGN_SOURCES = new Set(['story', 'jw-group', 'direct']);
const FILTER_KEYS = new Set(['availability', 'condition', 'maxPrice', 'sort', 'showSold']);
const CATEGORIES = new Set([
  'Muebles',
  'Oficina',
  'Electrodomésticos',
  'Accesorios personales',
  'Decoración',
  'Hogar',
  'Jardín',
  'Electrónica',
  'Cocina',
  'Herramientas',
  'Manualidades',
  'Accesorios',
  'Juegos',
  'Otros',
  'Salud',
  'Salud y cuidado personal',
]);
const FILTER_VALUES = Object.freeze({
  availability: new Set(['IMMEDIATE', 'DELAYED', 'REDUCED']),
  condition: new Set(['EXCELLENT', 'VERY_GOOD', 'GOOD', 'DETAILS']),
  maxPrice: new Set(['500000', '1000000', '2000000', '3000000']),
  sort: new Set(['price-asc', 'price-desc', 'newest']),
  showSold: new Set(['true']),
});
const PAYMENTS_REQUIRING_ATTENTION = new Set([
  'AWAITING_INITIAL_PAYMENT',
  'RECEIPT_RECEIVED',
  'VERIFYING_PAYMENT',
]);

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function optionalText(value, label, maximum) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw invalid(`${label} no es válido.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw invalid(`${label} no es válido.`);
  return normalized;
}

function optionalInteger(value, label, minimum, maximum) {
  if (value == null || value === '') return null;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw invalid(`${label} no es válido.`);
  }
  return value;
}

export function normalizeCampaignSource(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CAMPAIGN_SOURCES.has(normalized) ? normalized : 'direct';
}

export function hashAnonymousSession(sessionId) {
  const normalized = String(sessionId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    return null;
  }
  return createHash('sha256').update(`sale-pulse-v1\0${normalized}`).digest('hex');
}

export function validateAnalyticsEvent(input, { allowAddToCart = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('El evento no es válido.');
  }

  const allowedFields = new Set([
    'eventType',
    'productId',
    'campaignSource',
    'category',
    'searchTerm',
    'filters',
    'resultPosition',
    'resultCount',
  ]);
  if (Object.keys(input).some((key) => !allowedFields.has(key))) {
    throw invalid('El evento contiene campos no permitidos.');
  }

  const eventType = String(input.eventType || '').trim().toUpperCase();
  if (!EVENT_TYPES.has(eventType) || (!allowAddToCart && !PUBLIC_EVENT_TYPES.has(eventType))) {
    throw invalid('El tipo de evento no es válido.');
  }

  const productId = optionalText(input.productId, 'El artículo', 160);
  if (productId && !/^[a-z0-9._:-]+$/i.test(productId)) throw invalid('El artículo no es válido.');
  if (['PRODUCT_VIEW', 'ADD_TO_CART'].includes(eventType) && !productId) {
    throw invalid('Falta el artículo del evento.');
  }

  const category = optionalText(input.category, 'La categoría', 80);
  const submittedSearchTerm = optionalText(input.searchTerm, 'La búsqueda', 120);
  const searchTerm = null;
  if (category && !CATEGORIES.has(category)) throw invalid('La categoría no es válida.');
  if (eventType === 'CATEGORY_SELECT' && !category) throw invalid('Falta la categoría seleccionada.');
  if (eventType === 'SEARCH' && !submittedSearchTerm) throw invalid('Falta la búsqueda.');

  let filters = {};
  if (input.filters != null) {
    if (typeof input.filters !== 'object' || Array.isArray(input.filters)) {
      throw invalid('Los filtros no son válidos.');
    }
    for (const [key, value] of Object.entries(input.filters)) {
      const normalizedValue = typeof value === 'string' ? value.trim() : '';
      if (!FILTER_KEYS.has(key) || !FILTER_VALUES[key]?.has(normalizedValue)) {
        throw invalid('Los filtros no son válidos.');
      }
      filters[key] = normalizedValue;
    }
  }
  if (eventType === 'FILTER_APPLY' && !Object.keys(filters).length) {
    throw invalid('Falta el filtro aplicado.');
  }

  const resultPosition = optionalInteger(input.resultPosition, 'La posición', 1, 5000);
  const resultCount = optionalInteger(input.resultCount, 'La cantidad de resultados', 0, 5000);
  if (resultPosition != null && resultCount != null && resultPosition > resultCount) {
    throw invalid('La posición supera la cantidad de resultados.');
  }

  return {
    eventType,
    productId,
    campaignSource: normalizeCampaignSource(input.campaignSource),
    category,
    searchTerm,
    filters,
    resultPosition,
    resultCount,
  };
}

export function dedupeWindowFor(eventType) {
  if (eventType === 'CATALOG_VISIT') return '30 minutes';
  if (eventType === 'PRODUCT_VIEW') return '15 minutes';
  return '5 minutes';
}

export async function recordAnalyticsEvent({ sessionId, event }, dependencies = {}) {
  const normalized = validateAnalyticsEvent(event, { allowAddToCart: true });
  const sessionHash = hashAnonymousSession(sessionId);
  const query = dependencies.query || ((sql, params) => database().pool.query(sql, params));
  const { rows } = await query(`
    INSERT INTO sale_analytics_events (
      event_type,anonymous_session_hash,product_id,campaign_source,category,
      filter_context,result_position,result_count
    )
    SELECT $1,$2,$3,$4,$5,$6::jsonb,$7,$8
    WHERE NOT EXISTS (
      SELECT 1 FROM sale_analytics_events existing
      WHERE existing.occurred_at >= clock_timestamp() - $9::interval
        AND existing.event_type = $1
        AND existing.anonymous_session_hash IS NOT DISTINCT FROM $2
        AND existing.product_id IS NOT DISTINCT FROM $3
        AND existing.campaign_source = $4
        AND existing.category IS NOT DISTINCT FROM $5
        AND existing.filter_context = $6::jsonb
    )
    RETURNING event_id,occurred_at
  `, [
    normalized.eventType,
    sessionHash,
    normalized.productId,
    normalized.campaignSource,
    normalized.category,
    JSON.stringify(normalized.filters),
    normalized.resultPosition,
    normalized.resultCount,
    dedupeWindowFor(normalized.eventType),
  ]);
  return { accepted: rows.length > 0, sessionHashed: Boolean(sessionHash) };
}

function milliseconds(value) {
  if (value == null) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function publicProduct(product) {
  return {
    productId: product.id,
    itemNumber: Number(product.itemNumber || 0) || null,
    title: String(product.title || 'Artículo'),
    views: 0,
    cartAdds: 0,
  };
}

function metricWindow(events, startAt) {
  const recent = events.filter((event) => milliseconds(event.occurredAt) >= startAt);
  return {
    visitors: new Set(recent.map((event) => event.sessionHash).filter(Boolean)).size,
    catalogVisits: recent.filter((event) => event.eventType === 'CATALOG_VISIT').length,
    productViews: recent.filter((event) => event.eventType === 'PRODUCT_VIEW').length,
    distinctProductsViewed: new Set(recent
      .filter((event) => event.eventType === 'PRODUCT_VIEW' && event.productId)
      .map((event) => event.productId)).size,
    addToCart: recent.filter((event) => event.eventType === 'ADD_TO_CART').length,
  };
}

function salesWindow(orders, startAt) {
  const recent = orders.filter((order) => milliseconds(order.committedAt) >= startAt);
  return {
    confirmedOrders: recent.length,
    unitsSold: recent.reduce((total, order) => total + (Array.isArray(order.items) ? order.items : [])
      .reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0), 0),
  };
}

function sourceBreakdown(events, startAt) {
  const recent = events.filter((event) => milliseconds(event.occurredAt) >= startAt);
  return Object.fromEntries(['story', 'jw-group', 'direct'].map((source) => {
    const sourceEvents = recent.filter((event) => normalizeCampaignSource(event.campaignSource) === source);
    return [source, {
      visitors: new Set(sourceEvents.map((event) => event.sessionHash).filter(Boolean)).size,
      visits: sourceEvents.filter((event) => event.eventType === 'CATALOG_VISIT').length,
      views: sourceEvents.filter((event) => event.eventType === 'PRODUCT_VIEW').length,
    }];
  }));
}

function productSort(a, b) {
  return b.cartAdds - a.cartAdds || b.views - a.views ||
    Number(a.itemNumber || Number.MAX_SAFE_INTEGER) - Number(b.itemNumber || Number.MAX_SAFE_INTEGER) ||
    a.productId.localeCompare(b.productId);
}

function lowInterestSort(a, b) {
  return a.views - b.views || a.cartAdds - b.cartAdds ||
    Number(a.itemNumber || Number.MAX_SAFE_INTEGER) - Number(b.itemNumber || Number.MAX_SAFE_INTEGER) ||
    a.productId.localeCompare(b.productId);
}

const quantity = (value) => Math.max(0, Number(value) || 0);

function marketingProduct(product, inventory, publicIds) {
  const row = inventory.get(product.id);
  const remaining = quantity(product.quantityRemaining);
  const quantityRemaining = row
    ? Math.min(remaining, Math.max(0, Number(row.capacity) - Number(row.committed_quantity)))
    : remaining;
  const cartHeldQuantity = quantity(row?.cart_held_quantity);
  const orderHeldQuantity = quantity(row?.order_held_quantity);
  const status = String(product.status || '').trim().toUpperCase();
  let marketabilityStatus = 'NOT_MARKETABLE';
  let marketabilityReason = 'NOT_PUBLIC_SALE_CANDIDATE';
  // Fail closed if inventory is missing; never probe availability by claiming a cart.
  const purchasableQuantity = row ? Math.min(quantityRemaining, quantity(row.purchasable_quantity)) : 0;
  if (!publicIds.has(product.id)) {
    // Internal products never become candidates, regardless of stock.
  } else if (['SOLD', 'PICKED_UP'].includes(status) || quantityRemaining <= 0) {
    marketabilityStatus = 'SOLD';
    marketabilityReason = 'SOLD_OR_UNAVAILABLE';
  } else if (status !== 'AVAILABLE') {
    marketabilityReason = 'NOT_AVAILABLE_FOR_PUBLIC_SALE';
  } else if (!row) {
    marketabilityReason = 'INVENTORY_NOT_VERIFIED';
  } else if (purchasableQuantity > 0) {
    marketabilityStatus = 'MARKETABLE';
    marketabilityReason = 'PURCHASABLE_UNITS_AVAILABLE';
  } else if (orderHeldQuantity > 0) {
    marketabilityStatus = 'PENDING_PAYMENT_OR_CONFIRMATION';
    marketabilityReason = 'ACTIVE_ORDER_HOLD';
  } else if (cartHeldQuantity > 0) {
    marketabilityStatus = 'TEMPORARILY_RESERVED';
    marketabilityReason = 'ACTIVE_CART_HOLD';
  } else {
    marketabilityReason = 'NO_PURCHASABLE_UNITS';
  }
  // Explicit allowlist: never spread catalog, reservation or checkout records.
  return {
    ...publicProduct(product),
    slug: String(product.slug || ''),
    productUrl: product.slug ? `/producto/${encodeURIComponent(product.slug)}` : null,
    category: String(product.category || ''),
    askingPricePYG: Number(product.askingPricePYG || 0),
    saleMode: String(product.saleMode || ''),
    mainImage: typeof product.mainImage === 'string' ? product.mainImage : null,
    quantityRemaining,
    purchasableQuantity,
    cartHeldQuantity,
    orderHeldQuantity,
    nextReleaseAt: milliseconds(row?.next_release_at) == null ? null : new Date(row.next_release_at).toISOString(),
    marketabilityStatus,
    marketabilityReason,
  };
}

export function buildSalePulseSnapshot({
  events = [],
  products = [],
  purchasableInventory = new Map(),
  orders = [],
  operationalCounts = {},
  trackingStartedAt = null,
  generatedAt = Date.now(),
} = {}) {
  const now = milliseconds(generatedAt) ?? Date.now();
  const start = milliseconds(trackingStartedAt) ?? events
    .map((event) => milliseconds(event.occurredAt))
    .filter((value) => value != null)
    .sort((a, b) => a - b)[0] ?? null;
  const trackingAgeHours = start == null ? 0 : Math.max(0, (now - start) / 3600000);
  const start24 = now - 24 * 3600000;
  const start7d = now - 7 * 24 * 3600000;
  const event24 = metricWindow(events, start24);
  const event7d = metricWindow(events, start7d);
  const sale24 = salesWindow(orders, start24);
  const sale7d = salesWindow(orders, start7d);
  const available = products.filter((product) =>
    String(product.status || '').toUpperCase() === 'AVAILABLE' && Number(product.quantityRemaining || 0) > 0);
  // Delivery exclusions only remove zero-stock products, already ineligible here.
  const publicIds = new Set(projectPublicCatalog(products, []).products.map((product) => product.id));
  const marketingProducts = products.map((product) => marketingProduct(product, purchasableInventory, publicIds));
  const soldProductIds = new Set(orders.flatMap((order) => (Array.isArray(order.items) ? order.items : []))
    .map((item) => String(item?.productId || '')).filter(Boolean));
  const signalById = new Map(marketingProducts.map((product) => [product.productId, product]));

  for (const event of events) {
    if (milliseconds(event.occurredAt) < start7d || !signalById.has(event.productId)) continue;
    const signal = signalById.get(event.productId);
    if (event.eventType === 'PRODUCT_VIEW') signal.views += 1;
    if (event.eventType === 'ADD_TO_CART') signal.cartAdds += 1;
  }

  const signals = [...signalById.values()].filter((product) => product.marketabilityStatus === 'MARKETABLE');
  const hotUnSold = signals.filter((item) => !soldProductIds.has(item.productId) && item.views + item.cartAdds > 0)
    .sort(productSort).slice(0, 5);
  const viewedButNotAdded = signals.filter((item) => item.views > 0 && item.cartAdds === 0)
    .sort(productSort).slice(0, 5);
  const cartInterestWithoutSale = signals.filter((item) => item.cartAdds > 0 && !soldProductIds.has(item.productId))
    .sort(productSort).slice(0, 5);
  const attention = [...cartInterestWithoutSale, ...viewedButNotAdded]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.productId === item.productId) === index)
    .slice(0, 5);
  const lowInterestReady = trackingAgeHours >= LOW_INTEREST_MINIMUM_HOURS;
  const lowNoInterest = lowInterestReady
    ? signals.slice().sort(lowInterestSort).slice(0, 5)
    : [];

  const snapshot = {
    tracking: {
      startedAt: start == null ? null : new Date(start).toISOString(),
      generatedAt: new Date(now).toISOString(),
      ageHours: Math.round(trackingAgeHours * 10) / 10,
      historyWarning: 'Los datos de navegación existen únicamente desde el despliegue de Sale Pulse; no hay historial anterior.',
      lowInterestReady,
      lowInterestGuard: lowInterestReady
        ? null
        : `Se requieren al menos ${LOW_INTEREST_MINIMUM_HOURS} horas de seguimiento antes de clasificar baja visibilidad.`,
    },
    inventory: {
      availableProducts: available.length,
      availableUnits: available.reduce((sum, product) => sum + Math.max(0, Number(product.quantityRemaining || 0)), 0),
      soldOrUnavailableProducts: products.length - available.length,
    },
    last24Hours: { ...event24, ...sale24 },
    last7Days: { ...event7d, ...sale7d },
    sources: sourceBreakdown(events, start7d),
    productSignals: { attention, hotUnSold, lowNoInterest, viewedButNotAdded, cartInterestWithoutSale },
    operations: {
      paymentsRequiringAttention: Number(operationalCounts.paymentsRequiringAttention || 0),
      eligiblePickupsUnscheduled: Number(operationalCounts.eligiblePickupsUnscheduled || 0),
      scheduledPickupsPending: Number(operationalCounts.scheduledPickupsPending || 0),
    },
    limitations: [
      'Las ventas recientes incluyen pedidos con inventario confirmado y fecha verificable en el sistema actual.',
      'Ventas manuales o históricas sin fecha confiable pueden figurar en el inventario actual, pero no en las ventanas de 24 horas o 7 días.',
    ],
  };
  const signalLists = {
    hotUnsold: hotUnSold, lowNoInterest, attention, viewedButNotAdded, cartInterestWithoutSale,
  };
  for (const product of marketingProducts) {
    product.signals = Object.fromEntries(Object.entries(signalLists)
      .map(([key, items]) => [key, items.some((item) => item.productId === product.productId)]));
  }
  snapshot.marketingPacket = {
    schemaVersion: 1,
    generatedAt: snapshot.tracking.generatedAt,
    productUrlBasePath: '/producto/',
    signalWindowDays: 7,
    tracking: snapshot.tracking,
    inventory: snapshot.inventory,
    marketabilitySummary: {
      marketable: signals.length,
      temporarilyReserved: marketingProducts.filter((product) => product.marketabilityStatus === 'TEMPORARILY_RESERVED').length,
      pendingPaymentOrConfirmation: marketingProducts.filter((product) => product.marketabilityStatus === 'PENDING_PAYMENT_OR_CONFIRMATION').length,
      sold: marketingProducts.filter((product) => product.marketabilityStatus === 'SOLD').length,
      notMarketable: marketingProducts.filter((product) => product.marketabilityStatus === 'NOT_MARKETABLE').length,
      purchasableUnits: signals.reduce((sum, product) => sum + product.purchasableQuantity, 0),
    },
    traffic: { last24Hours: snapshot.last24Hours, last7Days: snapshot.last7Days, sources: snapshot.sources },
    products: marketingProducts.filter((product) => publicIds.has(product.productId)),
    marketableProducts: signals,
    signalLists: Object.fromEntries(Object.entries(signalLists)
      .map(([key, items]) => [key, items.map((item) => item.productId)])),
  };
  snapshot.marketingBrief = buildMarketingBrief(snapshot);
  return snapshot;
}

function briefProduct(item) {
  const number = item.itemNumber == null ? item.productId : String(item.itemNumber).padStart(3, '0');
  return `Item ${number} - ${item.title} - ${item.views} vistas - ${item.cartAdds} agregados al carrito`;
}

export function buildMarketingBrief(snapshot) {
  const timestamp = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(snapshot.tracking.generatedAt));
  const trackingStart = snapshot.tracking.startedAt
    ? new Intl.DateTimeFormat('es-PY', {
        timeZone: 'America/Asuncion', dateStyle: 'short', timeStyle: 'short',
      }).format(new Date(snapshot.tracking.startedAt))
    : 'Aún sin eventos registrados';
  const source = (key) => snapshot.sources[key] || { visitors: 0, visits: 0, views: 0 };
  const products = (items) => items.length ? items.map(briefProduct).join('\n') : 'Sin señal suficiente todavía.';
  return [
    'SALE PULSE',
    `Fecha/hora: ${timestamp}`,
    `Datos de navegación desde: ${trackingStart}`,
    '',
    'INVENTARIO:',
    `Disponibles: ${snapshot.inventory.availableProducts}`,
    `Unidades disponibles: ${snapshot.inventory.availableUnits}`,
    '',
    'ÚLTIMAS 24 HORAS:',
    `Visitantes aproximados: ${snapshot.last24Hours.visitors}`,
    `Visitas al catálogo: ${snapshot.last24Hours.catalogVisits}`,
    `Vistas de productos: ${snapshot.last24Hours.productViews}`,
    `Productos distintos vistos: ${snapshot.last24Hours.distinctProductsViewed}`,
    `Agregados al carrito: ${snapshot.last24Hours.addToCart}`,
    `Pedidos confirmados: ${snapshot.last24Hours.confirmedOrders}`,
    `Artículos vendidos: ${snapshot.last24Hours.unitsSold}`,
    '',
    'ÚLTIMOS 7 DÍAS:',
    `Visitantes aproximados: ${snapshot.last7Days.visitors}`,
    `Visitas al catálogo: ${snapshot.last7Days.catalogVisits}`,
    `Vistas de productos: ${snapshot.last7Days.productViews}`,
    `Productos distintos vistos: ${snapshot.last7Days.distinctProductsViewed}`,
    `Agregados al carrito: ${snapshot.last7Days.addToCart}`,
    `Pedidos confirmados: ${snapshot.last7Days.confirmedOrders}`,
    `Artículos vendidos: ${snapshot.last7Days.unitsSold}`,
    '',
    'ORIGEN DE TRÁFICO (7 DÍAS):',
    `Story: ${source('story').visitors} visitantes / ${source('story').visits} visitas / ${source('story').views} vistas`,
    `Grupo Compras/Ventas: ${source('jw-group').visitors} visitantes / ${source('jw-group').visits} visitas / ${source('jw-group').views} vistas`,
    `Directo: ${source('direct').visitors} visitantes / ${source('direct').visits} visitas / ${source('direct').views} vistas`,
    '',
    'PRODUCTOS CON INTERÉS SIN VENTA:',
    products(snapshot.productSignals.hotUnSold),
    '',
    'PRODUCTOS CON POCA O NULA VISIBILIDAD:',
    snapshot.tracking.lowInterestReady
      ? products(snapshot.productSignals.lowNoInterest)
      : snapshot.tracking.lowInterestGuard,
    '',
    'OPERACIÓN:',
    `Pagos pendientes: ${snapshot.operations.paymentsRequiringAttention}`,
    `Retiros elegibles sin horario: ${snapshot.operations.eligiblePickupsUnscheduled}`,
    `Retiros programados pendientes: ${snapshot.operations.scheduledPickupsPending}`,
    '',
    snapshot.tracking.historyWarning,
  ].join('\n');
}

export function paymentsRequiringAttention(orders) {
  return orders.filter((order) => PAYMENTS_REQUIRING_ATTENTION.has(String(order?.status || ''))).length;
}
