// First-party, privacy-limited storefront analytics for the temporary sale.
(function () {
  const SOURCE_KEY = 'psych-sale-pulse-source';
  const DISCOVERY_KEY = 'psych-sale-pulse-discovery';
  const ALLOWED_SOURCES = new Set(['story', 'jw-group']);
  let currentProductContext = null;

  function sourceForSession() {
    const stored = sessionStorage.getItem(SOURCE_KEY);
    if (stored) return ALLOWED_SOURCES.has(stored) ? stored : 'direct';
    const requested = String(new URLSearchParams(window.location.search).get('src') || '')
      .trim().toLowerCase();
    const source = ALLOWED_SOURCES.has(requested) ? requested : 'direct';
    sessionStorage.setItem(SOURCE_KEY, source);
    return source;
  }

  function cleanContext(context = {}) {
    const cleaned = {};
    if (context.category) cleaned.category = String(context.category).slice(0, 80);
    if (context.searchTerm) cleaned.searchTerm = String(context.searchTerm).slice(0, 120);
    if (context.filters && typeof context.filters === 'object') cleaned.filters = context.filters;
    if (Number.isInteger(context.resultPosition)) cleaned.resultPosition = context.resultPosition;
    if (Number.isInteger(context.resultCount)) cleaned.resultCount = context.resultCount;
    return cleaned;
  }

  async function track(eventType, context = {}) {
    try {
      await Promise.resolve(window.__staticCartReady).catch(() => null);
      await fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventType,
          campaignSource: sourceForSession(),
          ...cleanContext(context),
          ...(context.productId ? { productId: String(context.productId).slice(0, 160) } : {}),
        }),
        keepalive: true,
      });
    } catch {
      // Analytics is deliberately invisible to buyers and never blocks commerce.
    }
  }

  function rememberProductDiscovery(product, context = {}) {
    if (!product?.id) return;
    const saved = {
      productId: product.id,
      slug: product.slug || '',
      savedAt: Date.now(),
      ...cleanContext(context),
    };
    currentProductContext = saved;
    try {
      sessionStorage.setItem(DISCOVERY_KEY, JSON.stringify(saved));
    } catch {}
  }

  function discoveryFor(product) {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(DISCOVERY_KEY) || 'null');
    } catch {}
    if (!saved || saved.productId !== product?.id || Date.now() - Number(saved.savedAt || 0) > 30 * 60 * 1000) {
      return {};
    }
    sessionStorage.removeItem(DISCOVERY_KEY);
    return cleanContext(saved);
  }

  function trackProductView(product) {
    if (!product?.id) return;
    const context = discoveryFor(product);
    currentProductContext = { productId: product.id, ...context };
    void track('PRODUCT_VIEW', { productId: product.id, ...context });
  }

  function cartContext(productId, explicitContext = null) {
    const context = explicitContext
      ? cleanContext(explicitContext)
      : currentProductContext?.productId === productId
        ? cleanContext(currentProductContext)
        : {};
    return { campaignSource: sourceForSession(), ...context };
  }

  window.salePulseTrack = (eventType, context) => void track(eventType, context);
  window.salePulseRememberProductDiscovery = rememberProductDiscovery;
  window.salePulseSetCartContext = (product, context) => {
    if (product?.id) currentProductContext = { productId: product.id, ...cleanContext(context) };
  };
  window.salePulseCartContext = cartContext;
  window.addEventListener('sale-pulse:product-view', (event) => {
    trackProductView(event.detail?.product);
  });

  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/index.html') {
    void track('CATALOG_VISIT');
  } else if (path.startsWith('/producto/')) {
    const productId = document.body.dataset.salePulseProductId;
    if (productId) {
      trackProductView({
        id: productId,
        slug: document.body.dataset.salePulseProductSlug || '',
      });
    }
  }
})();
