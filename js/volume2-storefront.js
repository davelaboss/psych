// File: js/volume2-storefront.js
// Single storefront controller for the complete public catalog.

(function () {
  const state = {
    products: [],
    filtered: [],
    controls: {},
  };

  window.addEventListener('load', boot);

  async function boot() {
    try {
      const original = collectOriginalProducts();
      const volume2 = await fetchVolume2();
      state.products = dedupe([...original, ...volume2])
        .sort((a, b) => Number(a.itemNumber) - Number(b.itemNumber));

      window.__catalogProducts = state.products;

      const path = cleanPath();

      if (path.startsWith('/producto/')) {
        const slug = decodeURIComponent(path.slice('/producto/'.length));
        const product = state.products.find((item) => item.slug === slug);
        if (product && typeof window.renderProductDetail === 'function') {
          window.renderProductDetail(product);
          installDetailLightbox();
        }
        return;
      }

      if (path === '/carrito') {
        if (typeof window.renderCartPage === 'function') {
          window.renderCartPage();
        }
        return;
      }

      if (path !== '/' && path !== '/index.html') return;

      buildCatalog();
    } catch (error) {
      console.error('Catálogo unificado:', error);
    }
  }

  function cleanPath() {
    return window.location.pathname.replace(/\/+$/, '') || '/';
  }

  function collectOriginalProducts() {
    const seen = new Set();
    const products = [];

    document.querySelectorAll('.product-grid a[href^="/producto/"]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      const slug = decodeURIComponent(href.split('/producto/')[1] || '');
      if (!slug || seen.has(slug)) return;
      seen.add(slug);

      const product =
        typeof window.getEmbeddedProductBySlug === 'function'
          ? window.getEmbeddedProductBySlug(slug)
          : null;

      if (product) products.push(product);
    });

    return products;
  }

  async function fetchVolume2() {
    const response = await fetch('/.netlify/functions/volume2-catalog', {
      cache: 'no-store',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'No se pudo cargar Volumen 2.');
    }

    return Array.isArray(data.products) ? data.products : [];
  }

  function dedupe(products) {
    const byId = new Map();
    products.forEach((product) => {
      if (product?.id) byId.set(product.id, product);
    });
    return [...byId.values()];
  }

  function buildCatalog() {
    const grid = document.querySelector('.product-grid');
    const panel = document.querySelector('.search-panel');
    if (!grid || !panel) return;

    grid.innerHTML = '';
    state.products.forEach((product) => grid.appendChild(renderCard(product)));

    prepareControls(panel);
    installCatalogEvents(grid);
    applyFilters();

    const heading = document.querySelector('.catalog-heading > p');
    if (heading) {
      heading.textContent = `${state.products.length} artículos · Retiro en San Lorenzo`;
    }

    installStyles();
  }

  function prepareControls(panel) {
    const searchLabel = panel.querySelector('.search-field');
    if (searchLabel) {
      searchLabel.innerHTML = `
        <span>Buscar</span>
        <input type="search" placeholder="Buscar heladera, mesa, herramientas…" autocomplete="off">
      `;
    }

    const selects = [...panel.querySelectorAll('select')];
    const condition = selects[2];

    if (condition) {
      condition.innerHTML = `
        <option value="ALL">Todos</option>
        <option value="EXCELLENT">Excelente</option>
        <option value="VERY_GOOD">Muy buen estado</option>
        <option value="GOOD">Buen estado</option>
        <option value="DETAILS">Con detalles</option>
      `;
    }

    state.controls = {
      search: panel.querySelector('input[type="search"]'),
      category: selects[0],
      availability: selects[1],
      condition,
      price: selects[3],
      sort: selects[4],
      reset: document.querySelector('.reset-filters'),
      categoryButtons: [...document.querySelectorAll('.category-row button:not(.reset-filters)')],
    };

    let counter = document.querySelector('[data-catalog-results]');
    if (!counter) {
      counter = document.createElement('div');
      counter.dataset.catalogResults = 'true';
      counter.className = 'catalog-results-unified';
      panel.insertAdjacentElement('afterend', counter);
    }
    state.controls.counter = counter;
  }

  function installCatalogEvents(grid) {
    const c = state.controls;

    c.search?.addEventListener('input', applyFilters);
    [c.category, c.availability, c.condition, c.price, c.sort]
      .forEach((select) => select?.addEventListener('change', applyFilters));

    c.categoryButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const wanted = normalize(button.textContent);
        const option = [...(c.category?.options || [])]
          .find((item) => normalize(item.textContent) === wanted);
        if (option) c.category.value = option.value;

        c.categoryButtons.forEach((other) =>
          other.classList.toggle('active', other === button)
        );
        applyFilters();
      });
    });

    c.reset?.addEventListener('click', (event) => {
      event.preventDefault();
      c.search.value = '';
      c.category.selectedIndex = 0;
      c.availability.value = 'ALL';
      c.condition.value = 'ALL';
      c.price.selectedIndex = 0;
      c.sort.value = 'recommended';
      c.categoryButtons.forEach((button) =>
        button.classList.toggle('active', normalize(button.textContent) === 'todas')
      );
      c.reset.classList.remove('active');
      applyFilters();
    });

    grid.addEventListener('click', (event) => {
      const card = event.target.closest('.product-card');
      if (!card) return;

      const id = card.dataset.productId;
      const product = state.products.find((item) => item.id === id);
      if (!product) return;

      const cartButton = event.target.closest('[data-cart-action]');
      if (cartButton) {
        event.preventDefault();
        event.stopPropagation();
        if (product.status !== 'AVAILABLE') return;
        if (typeof window.addStaticCartItem === 'function') {
          window.addStaticCartItem(product.id);
          cartButton.textContent = 'En carrito';
          cartButton.disabled = true;
        }
        return;
      }

      const photoButton = event.target.closest('[data-photo-action]');
      if (photoButton) {
        event.preventDefault();
        event.stopPropagation();
        createLightbox(product.images || [], 0);
        return;
      }

      event.preventDefault();
      window.location.assign(`/producto/${encodeURIComponent(product.slug)}`);
    });
  }

  function applyFilters() {
    const c = state.controls;
    const query = normalize(c.search?.value || '');
    const category = normalize(c.category?.selectedOptions?.[0]?.textContent || '');
    const availability = c.availability?.value || 'ALL';
    const condition = c.condition?.value || 'ALL';
    const maxPrice = Number(c.price?.value || 0);

    state.filtered = state.products.filter((product) => {
      const item = Number(product.itemNumber);
      const numeric = query.match(/^(?:item\s*)?0*(\d{1,3})$/);
      const searchOkay = !query ||
        (numeric
          ? item === Number(numeric[1])
          : normalize([
              product.title,
              product.category,
              product.description,
              `item ${String(item).padStart(3, '0')}`,
              String(item),
            ].join(' ')).includes(query));

      const categoryOkay =
        !category || category === 'todas' || normalize(product.category) === category;

      const availabilityOkay =
        availability === 'ALL' ||
        (availability === 'IMMEDIATE' && product.saleMode === 'IMMEDIATE') ||
        (availability === 'DELAYED' && product.saleMode === 'DELAYED') ||
        (availability === 'REDUCED' && Number(product.originalPricePYG || 0) > Number(product.askingPricePYG || 0));

      const conditionOkay =
        condition === 'ALL' || conditionBucket(product) === condition;

      const priceOkay =
        !maxPrice || Number(product.askingPricePYG || 0) <= maxPrice;

      return searchOkay && categoryOkay && availabilityOkay && conditionOkay && priceOkay;
    });

    sortProducts(state.filtered);

    const grid = document.querySelector('.product-grid');
    if (grid) {
      const visibleIds = new Set(state.filtered.map((product) => product.id));
      const order = new Map(state.filtered.map((product, index) => [product.id, index]));

      [...grid.children]
        .sort((a, b) => {
          const ai = order.has(a.dataset.productId) ? order.get(a.dataset.productId) : 999999;
          const bi = order.has(b.dataset.productId) ? order.get(b.dataset.productId) : 999999;
          return ai - bi;
        })
        .forEach((card) => {
          card.hidden = !visibleIds.has(card.dataset.productId);
          grid.appendChild(card);
        });
    }

    if (c.counter) {
      c.counter.textContent =
        state.filtered.length === state.products.length
          ? `${state.products.length} artículos`
          : `${state.filtered.length} de ${state.products.length} artículos`;
    }
  }

  function sortProducts(products) {
    const mode = state.controls.sort?.value || 'recommended';

    if (mode === 'price-asc') {
      products.sort((a, b) => Number(a.askingPricePYG) - Number(b.askingPricePYG));
    } else if (mode === 'price-desc') {
      products.sort((a, b) => Number(b.askingPricePYG) - Number(a.askingPricePYG));
    } else if (mode === 'newest') {
      products.sort((a, b) => Number(b.itemNumber) - Number(a.itemNumber));
    } else if (mode === 'reduced') {
      products.sort((a, b) => {
        const ar = Number(a.originalPricePYG || 0) > Number(a.askingPricePYG || 0);
        const br = Number(b.originalPricePYG || 0) > Number(b.askingPricePYG || 0);
        return Number(br) - Number(ar) || Number(a.itemNumber) - Number(b.itemNumber);
      });
    } else {
      products.sort((a, b) => Number(a.itemNumber) - Number(b.itemNumber));
    }
  }

  function renderCard(product) {
    const article = document.createElement('article');
    article.className = `product-card${product.status !== 'AVAILABLE' ? ' is-sold' : ''}`;
    article.dataset.productId = product.id;

    const delayed = product.saleMode === 'DELAYED';
    const available = product.status === 'AVAILABLE';
    const image = product.images?.[0] || '';
    const quantity = Number(product.quantityRemaining || product.quantityTotal || 1);
    const multiple = Number(product.quantityTotal || 1) > 1;

    article.innerHTML = `
      <button class="product-photo" type="button" data-photo-action aria-label="Ver fotos de ${escapeAttr(product.title)}">
        ${image ? `<img src="${escapeAttr(withLeadingSlash(image))}" alt="${escapeAttr(product.title)}" loading="lazy">` : ''}
        ${!available ? '<span class="sold-ribbon">VENDIDO</span>' : ''}
        <span class="image-enlarge-hint">Ver foto(s)</span>
      </button>
      <div class="product-copy">
        <div class="product-meta">
          <span>${escapeHtml(product.category || '')}</span>
          <span class="${!available ? 'status-unavailable' : delayed ? 'status-later' : 'status-now'}">
            ${!available ? 'VENDIDO' : delayed ? 'RETIRO 9–12 DIC.' : 'DISPONIBLE AHORA'}
          </span>
        </div>
        <span class="item-number">Item ${String(product.itemNumber).padStart(3, '0')}</span>
        <a href="/producto/${escapeAttr(product.slug)}"><h3>${escapeHtml(product.title)}</h3></a>
        <strong class="price">${formatMoney(product.askingPricePYG)}${multiple ? ' por unidad' : ''}</strong>
        ${multiple ? `<p>${quantity} unidades disponibles</p>` : ''}
        <p>${escapeHtml(delayed ? `Reserva ${Number(product.depositPercent || 25)}% · Retiro 9–12 de diciembre` : publicCondition(product))}</p>
        <div class="card-actions">
          <a href="/producto/${escapeAttr(product.slug)}">Ver detalle</a>
          <button type="button" data-cart-action ${!available ? 'disabled' : ''}>
            ${!available ? 'No disponible' : delayed ? 'Reservar' : 'Agregar'}
          </button>
        </div>
      </div>
    `;

    return article;
  }

  function publicCondition(product) {
    const value = String(product.condition || '').trim();
    return value || 'Buen estado';
  }

  function conditionBucket(product) {
    const text = normalize(`${product.condition || ''} ${product.conditionNotes || ''}`);
    if (text.includes('excelente') || text.includes('como nuevo')) return 'EXCELLENT';
    if (text.includes('muy buen') || text.includes('poco uso')) return 'VERY_GOOD';
    if (
      text.includes('detalle') ||
      text.includes('desgaste') ||
      text.includes('marca') ||
      text.includes('parcial')
    ) return 'DETAILS';
    return 'GOOD';
  }

  function installDetailLightbox() {
    document.addEventListener('click', (event) => {
      const main = event.target.closest('.main-image');
      if (!main) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const slug = decodeURIComponent(cleanPath().slice('/producto/'.length));
      const product = state.products.find((item) => item.slug === slug);
      if (product) createLightbox(product.images || [], 0);
    }, true);
  }

  function createLightbox(images, initialIndex) {
    const clean = [...new Set(images.map(withLeadingSlash).filter(Boolean))];
    if (!clean.length) return;

    let index = Math.max(0, Math.min(initialIndex || 0, clean.length - 1));
    let zoom = 1;
    let dragging = false;
    let startX = 0, startY = 0, scrollX = 0, scrollY = 0;

    const box = document.createElement('div');
    box.className = 'catalog-lightbox';
    box.innerHTML = `
      <div class="catalog-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Fotos del artículo">
        <header>
          <strong>Fotos del artículo</strong>
          <span data-count></span>
          <button type="button" data-close aria-label="Cerrar">×</button>
        </header>
        <div class="catalog-lightbox-stage">
          <button type="button" data-prev aria-label="Anterior">‹</button>
          <div class="catalog-lightbox-canvas" data-canvas>
            <img data-image alt="" draggable="false">
          </div>
          <button type="button" data-next aria-label="Siguiente">›</button>
        </div>
        <footer>
          <button type="button" data-out>−</button>
          <strong data-zoom>100%</strong>
          <button type="button" data-in>+</button>
          <button type="button" data-reset>Restablecer</button>
          <span>Rueda del mouse para zoom · arrastrá para mover</span>
        </footer>
      </div>
    `;
    document.body.appendChild(box);

    const canvas = box.querySelector('[data-canvas]');
    const image = box.querySelector('[data-image]');
    const count = box.querySelector('[data-count]');
    const label = box.querySelector('[data-zoom]');
    let baseW = 0, baseH = 0;

    function fit() {
      const scale = Math.min(
        (canvas.clientWidth - 24) / image.naturalWidth,
        (canvas.clientHeight - 24) / image.naturalHeight,
        1
      );
      baseW = image.naturalWidth * scale;
      baseH = image.naturalHeight * scale;
      setZoom(1);
    }

    function setZoom(next) {
      zoom = Math.max(1, Math.min(4, next));
      image.style.width = `${Math.round(baseW * zoom)}px`;
      image.style.height = `${Math.round(baseH * zoom)}px`;
      image.style.maxWidth = 'none';
      image.style.maxHeight = 'none';
      label.textContent = `${Math.round(zoom * 100)}%`;
      canvas.classList.toggle('can-pan', zoom > 1);
      if (zoom === 1) {
        canvas.scrollLeft = 0;
        canvas.scrollTop = 0;
      }
    }

    function show() {
      zoom = 1;
      image.src = clean[index];
      count.textContent = `${index + 1} de ${clean.length}`;
    }

    function move(delta) {
      index = (index + delta + clean.length) % clean.length;
      show();
    }

    function close() {
      box.remove();
      document.removeEventListener('keydown', keys);
    }

    function keys(event) {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    }

    image.addEventListener('load', fit);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? .2 : -.2));
    }, { passive: false });

    canvas.addEventListener('pointerdown', (event) => {
      if (zoom <= 1) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      scrollX = canvas.scrollLeft;
      scrollY = canvas.scrollTop;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      canvas.scrollLeft = scrollX - (event.clientX - startX);
      canvas.scrollTop = scrollY - (event.clientY - startY);
    });

    canvas.addEventListener('pointerup', () => {
      dragging = false;
      canvas.classList.remove('dragging');
    });

    image.addEventListener('dblclick', () => setZoom(zoom === 1 ? 2 : 1));
    box.querySelector('[data-close]').addEventListener('click', close);
    box.querySelector('[data-prev]').addEventListener('click', () => move(-1));
    box.querySelector('[data-next]').addEventListener('click', () => move(1));
    box.querySelector('[data-in]').addEventListener('click', () => setZoom(zoom + .25));
    box.querySelector('[data-out]').addEventListener('click', () => setZoom(zoom - .25));
    box.querySelector('[data-reset]').addEventListener('click', () => setZoom(1));
    box.addEventListener('click', (event) => {
      if (event.target === box) close();
    });
    document.addEventListener('keydown', keys);
    show();
  }

  function installStyles() {
    if (document.getElementById('unified-catalog-styles')) return;
    const style = document.createElement('style');
    style.id = 'unified-catalog-styles';
    style.textContent = `
      .search-panel .search-field{display:grid!important;grid-template-rows:auto 1fr!important;gap:6px!important;padding:0!important;border:0!important;background:transparent!important;align-items:stretch!important}
      .search-panel .search-field>span{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
      .search-panel .search-field input{min-height:48px!important;width:100%!important;padding:0 14px!important;border:1px solid var(--line)!important;border-radius:8px!important;background:#fff!important;font:inherit!important;outline:none!important}
      .catalog-results-unified{margin:8px 0 14px;color:var(--forest);font-size:13px;font-weight:800}
      .product-card,.product-card:hover,.product-card:focus-within{transform:none!important;box-shadow:none!important;background:#fff!important;border-color:#e7e1d5!important}
      .product-card img,.product-card:hover img,.product-photo:hover img{transform:none!important;transition:none!important}
      .product-card{cursor:pointer}
      .card-actions button{cursor:pointer!important}
      .image-enlarge-hint{cursor:zoom-in!important}
      .reset-filters,.reset-filters:hover,.reset-filters:focus,.reset-filters:active{color:var(--forest)!important;background:transparent!important;border-color:var(--line)!important;box-shadow:none!important}
      .catalog-lightbox{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:18px;background:rgba(3,10,7,.95)}
      .catalog-lightbox-dialog{width:min(1450px,100%);height:min(920px,calc(100vh - 36px));display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;color:#fff;background:#151a17;border:1px solid rgba(255,255,255,.18);border-radius:12px}
      .catalog-lightbox header{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.15)}
      .catalog-lightbox button{min-height:40px;border:1px solid rgba(255,255,255,.4);border-radius:8px;background:#252c28;color:#fff;font-weight:800;cursor:pointer}
      .catalog-lightbox-stage{min-height:0;display:grid;grid-template-columns:54px minmax(0,1fr) 54px;gap:8px;padding:12px}
      .catalog-lightbox-stage>button{align-self:center;width:48px;font-size:30px}
      .catalog-lightbox-canvas{min-width:0;min-height:0;overflow:auto;display:grid;place-items:center;background:#0c100e;border-radius:8px;cursor:zoom-in;touch-action:none}
      .catalog-lightbox-canvas.can-pan{cursor:grab}.catalog-lightbox-canvas.dragging{cursor:grabbing}
      .catalog-lightbox-canvas img{display:block;object-fit:contain;user-select:none}
      .catalog-lightbox footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,.15)}
      .catalog-lightbox footer button{padding:4px 12px}.catalog-lightbox footer span{color:#c7d0cb;font-size:12px}
    `;
    document.head.appendChild(style);
  }

  function normalize(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function formatMoney(value) {
    return `Gs. ${Number(value || 0).toLocaleString('es-PY')}`;
  }

  function withLeadingSlash(value) {
    const text = String(value || '');
    if (!text) return '';
    if (/^(?:https?:|data:|blob:)/i.test(text)) return text;
    return text.startsWith('/') ? text : `/${text}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
