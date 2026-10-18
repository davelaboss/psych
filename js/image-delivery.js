// Browser delivery only. Catalog, Admin and social metadata retain originals.
(function () {
  const sizes = { small: 720, medium: 1440, brand: 252 };

  function original(source) {
    const value = String(source || '').trim();
    if (!value) return '';
    try { return new URL(value, window.location.origin + '/').href; }
    catch { return value; }
  }

  function resolve(source, size = 'small') {
    const canonical = original(source);
    if (!canonical || !sizes[size]) return canonical;
    let url;
    try { url = new URL(canonical, window.location.origin); }
    catch { return canonical; }
    if (url.origin !== window.location.origin) return canonical;
    const lookup = new URL(url);
    lookup.searchParams.delete('v');
    const key = lookup.pathname + lookup.search;
    if (!window.__imageDeliveryManifest?.[key]?.includes(size)) return canonical;
    return '/.netlify/images?' + new URLSearchParams({
      url: url.pathname + url.search, w: String(sizes[size]), h: String(sizes[size]),
      fit: 'contain', q: '85', fm: 'webp',
    });
  }

  // Capture also covers non-bubbling image errors and markup inserted later.
  // Retry the canonical source exactly once, including when CDN is unavailable.
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (img?.tagName !== 'IMG') return;
    const source = img.getAttribute('data-original-src');
    if (!source || img.dataset.originalRetried) return;
    img.dataset.originalRetried = 'true';
    img.removeAttribute('srcset');
    img.src = original(source);
  }, true);

  window.imageDelivery = Object.freeze({ resolve, original });
})();
