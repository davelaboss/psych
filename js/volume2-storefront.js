// File: js/volume2-storefront.js
// Single storefront controller for the complete public catalog.

(function () {
  const state = {
    products: [],
    filtered: [],
    controls: {},
    deliveredProduct: null,
    renderedCount: 0,
    loadObserver: null,
    catalogReady: false,
    restoringCatalog: false,
    historyTrackingInstalled: false,
    scrollSaveTimer: null,
    pageScrollPath: '',
    restoringPage: false,
    pageScrollTrackingInstalled: false,
    pageScrollSaveTimer: null,
    pageScrollY: 0,
    pageLinkNavigation: false,
  };

  const INITIAL_RENDER_COUNT = 48;
  const RENDER_BATCH_SIZE = 48;
  const CATALOG_HISTORY_KEY = 'mudanzaCatalogState';
  const CATALOG_HISTORY_VERSION = 1;
  const PAGE_SCROLL_HISTORY_KEY = 'mudanzaPageScrollState';
  const PAGE_SCROLL_HISTORY_VERSION = 1;
  const SCROLL_SAVE_DELAY_MS = 150;
  const CORE_CATEGORIES = [
    'Cocina',
    'Hogar',
    'Oficina',
    'Electrodomésticos',
    'Jardín',
    'Muebles',
    'Herramientas',
  ];

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  async function boot() {
    const path = cleanPath();

    configureBrowserScrollRestoration(path);
    const savedPageScroll = isPageScrollRoute(path)
      ? initializePageScrollRestoration(path)
      : null;

    if (path === '/carrito') {
      window.addEventListener('storefront:cart-rendered', () => {
        restorePageHistoryScroll(savedPageScroll);
      }, { once: true });
    }

    if (!isCatalogRoute(path)) return;

    installStyles();

    if (path.startsWith('/producto/')) {
      enhanceDetailPhotoAction();
      installDetailLightbox();
    }

    try {
      const requestedSlug = path.startsWith('/producto/')
        ? decodeURIComponent(path.slice('/producto/'.length))
        : '';
      const catalog = await fetchCatalog(requestedSlug);
      state.products = dedupe(catalog.products)
        .sort((a, b) => Number(a.itemNumber) - Number(b.itemNumber));
      state.deliveredProduct = catalog.deliveredProduct;

      window.__catalogProducts = state.products;

      if (path.startsWith('/producto/')) {
        const product = state.products.find((item) => item.slug === requestedSlug);

        if (product && typeof window.renderProductDetail === 'function') {
          window.renderProductDetail(product);
        } else if (state.deliveredProduct?.slug === requestedSlug) {
          renderDeliveredProductView(state.deliveredProduct);
        } else {
          renderUnavailableProductView();
        }

        enhanceDetailPhotoAction();
        restorePageHistoryScroll(savedPageScroll);
        return;
      }

      buildCatalog();
    } catch (error) {
      console.error('Catálogo unificado:', error);
      if (path === '/' || path === '/index.html') renderCatalogError();
      if (savedPageScroll) restorePageHistoryScroll(savedPageScroll);
    }
  }

  function cleanPath() {
    return window.location.pathname.replace(/\/+$/, '') || '/';
  }

  function isCatalogRoute(path) {
    return path === '/' || path === '/index.html' || path.startsWith('/producto/');
  }

  async function fetchCatalog(requestedSlug = '') {
    if (typeof window.loadAuthoritativeCatalog !== 'function') {
      throw new Error('No se pudo iniciar la carga del catálogo.');
    }

    return window.loadAuthoritativeCatalog(requestedSlug);
  }

  function renderCatalogError() {
    const catalog = document.querySelector('.catalog');
    if (!catalog) return;

    catalog.innerHTML = `
      <div class="empty-cart catalog-error" role="alert">
        <span>CATÁLOGO</span>
        <h2>No se pudieron cargar los artículos.</h2>
        <p>No mostramos información desactualizada. Intentá nuevamente en unos minutos.</p>
        <button class="primary-action" type="button" data-catalog-retry>Volver a intentar</button>
      </div>
    `;
    catalog.querySelector('[data-catalog-retry]')?.addEventListener('click', () => window.location.reload());
    document.documentElement.classList.remove('catalog-route-pending');
  }


  function renderDeliveredProductView(product) {
    const main = document.querySelector('main');
    if (!main) return;
    document.title = `${product.title || 'Artículo entregado'} | Venta de Mudanza`;
    document.body.classList.add('product-detail-route');
    main.innerHTML = `
      <section class="empty-cart delivered-product-view">
        <span>VENTA FINALIZADA</span>
        <h1>${escapeHtml(product.title || 'Artículo entregado')}</h1>
        <p><strong>Este artículo ya fue vendido y entregado.</strong></p>
        <p>Te invitamos a ver otros artículos disponibles.</p>
        <a class="primary-action" href="/#articulos">Ver artículos disponibles</a>
      </section>
    `;
    document.documentElement.classList.remove('product-route-pending');
  }


  function renderUnavailableProductView() {
    const main = document.querySelector('main');
    if (!main) return;
    document.title = 'Artículo no disponible | Venta de Mudanza';
    document.body.classList.add('product-detail-route');
    main.innerHTML = `
      <section class="empty-cart unavailable-product-view">
        <span>NO DISPONIBLE</span>
        <h1>No encontramos ese artículo.</h1>
        <p>Puede haberse retirado de la venta o estar pendiente de revisión.</p>
        <a class="primary-action" href="/#articulos">Volver al catálogo</a>
      </section>
    `;
    document.documentElement.classList.remove('product-route-pending');
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

    const savedState = readCatalogHistoryState(window.history.state);
    grid.innerHTML = '';
    prepareControls(panel);
    installCatalogEvents(grid);
    installCatalogHistoryTracking();
    state.catalogReady = true;

    if (savedState) {
      state.restoringCatalog = true;
      restoreCatalogState(savedState, {
        restoreControls: restoreCatalogControls,
        applyFilters: (renderedCount) => applyFilters(renderedCount, false),
        restoreScroll: restoreCatalogScroll,
        resumeLoading: installContinuousLoading,
      });
    } else {
      applyFilters();
      installContinuousLoading();
      persistCatalogHistoryState();
    }

    const heading = document.querySelector('.catalog-heading > p');
    if (heading) {
      const availableCount = state.products.filter((product) => product.status === 'AVAILABLE').length;
      heading.textContent = `${availableCount} artículos disponibles · Retiro en San Lorenzo`;
    }

    installStyles();
    document.documentElement.classList.remove('catalog-route-pending');
  }

  function prepareControls(panel) {
    document.querySelector('.category-row')?.remove();
    document.querySelector('[data-catalog-discovery]')?.remove();
    document.querySelector('[data-catalog-load-controls]')?.remove();

    panel.innerHTML = `
      <label class="catalog-search-label" for="catalog-search">
        <span>¿Qué estás buscando?</span>
        <input id="catalog-search" type="search" placeholder="Ej.: mesa, licuadora o Item 125" autocomplete="off">
        <small>Podés buscar por palabra o número de Item.</small>
      </label>
    `;

    const categories = [...new Set(state.products
      .map((product) => String(product.category || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    const categoryByName = new Map(categories.map((category) => [normalize(category), category]));
    const coreCategories = CORE_CATEGORIES
      .map((category) => categoryByName.get(normalize(category)))
      .filter(Boolean);
    const coreSet = new Set(coreCategories);
    const moreCategories = categories.filter((category) => !coreSet.has(category));
    const categoryOptions = ['Todas', ...categories]
      .map((category) => `<option value="${escapeAttr(category === 'Todas' ? '' : category)}">${escapeHtml(category)}</option>`)
      .join('');
    const categoryButtons = (items) => items
      .map((category) => `<button type="button" data-category-button data-category="${escapeAttr(category === 'Todas' ? '' : category)}">${escapeHtml(category)}</button>`)
      .join('');

    const discovery = document.createElement('div');
    discovery.dataset.catalogDiscovery = 'true';
    discovery.className = 'catalog-discovery';
    discovery.innerHTML = `
      <p class="category-prompt">O elegí una categoría</p>
      <div class="category-row" aria-label="Categorías principales">
        ${categoryButtons(['Todas', ...coreCategories])}
        <button class="more-categories-toggle" type="button" data-more-categories aria-expanded="false">Más categorías</button>
      </div>
      <div class="more-categories-panel" data-more-categories-panel hidden>
        <p>Todas las categorías</p>
        <div class="category-row category-row-more">${categoryButtons(moreCategories)}</div>
      </div>
      <fieldset class="availability-choices">
        <legend>¿Cuándo lo necesitás?</legend>
        <div class="availability-row">
          <button type="button" data-availability="ALL">Todos</button>
          <button type="button" data-availability="IMMEDIATE">Disponible ahora</button>
          <button type="button" data-availability="DELAYED">Retiro posterior</button>
        </div>
      </fieldset>
      <div class="catalog-toolbar">
        <strong data-catalog-results aria-live="polite"></strong>
        <details class="more-filters" data-more-filters>
          <summary>Más filtros <span data-filter-count hidden></span></summary>
          <div class="advanced-filter-grid">
            <label><span>Categoría</span><select data-category-select>${categoryOptions}</select></label>
            <label><span>Estado</span><select data-condition-select>
              <option value="ALL">Todos</option>
              <option value="EXCELLENT">Excelente</option>
              <option value="VERY_GOOD">Muy buen estado</option>
              <option value="GOOD">Buen estado</option>
              <option value="DETAILS">Con detalles</option>
            </select></label>
            <label><span>Precio máximo</span><select data-price-select>
              <option value="">Sin límite</option>
              <option value="500000">Gs. 500.000</option>
              <option value="1000000">Gs. 1.000.000</option>
              <option value="2000000">Gs. 2.000.000</option>
              <option value="3000000">Gs. 3.000.000</option>
            </select></label>
            <label><span>Ordenar</span><select data-sort-select>
              <option value="catalog">Orden del catálogo</option>
              <option value="newest">Más recientes</option>
              <option value="price-asc">Precio menor a mayor</option>
              <option value="price-desc">Precio mayor a menor</option>
            </select></label>
            <label class="show-sold-option"><input type="checkbox" data-show-sold> <span>Ver artículos vendidos</span></label>
            <button class="reset-filters" type="button" data-reset-filters hidden>Restablecer filtros</button>
          </div>
        </details>
      </div>
    `;
    panel.insertAdjacentElement('afterend', discovery);

    const grid = document.querySelector('.product-grid');
    const loadControls = document.createElement('div');
    loadControls.dataset.catalogLoadControls = 'true';
    loadControls.className = 'catalog-load-controls';
    loadControls.innerHTML = `
      <div class="empty-state" data-catalog-empty hidden><strong>No encontramos artículos con esos filtros.</strong><button type="button" data-empty-reset>Limpiar filtros</button></div>
      <button type="button" data-load-more>Cargar más artículos</button>
      <div data-load-sentinel aria-hidden="true"></div>
    `;
    grid?.insertAdjacentElement('afterend', loadControls);

    state.controls = {
      search: panel.querySelector('input[type="search"]'),
      category: discovery.querySelector('[data-category-select]'),
      availability: 'ALL',
      condition: discovery.querySelector('[data-condition-select]'),
      price: discovery.querySelector('[data-price-select]'),
      sort: discovery.querySelector('[data-sort-select]'),
      showSold: discovery.querySelector('[data-show-sold]'),
      reset: discovery.querySelector('[data-reset-filters]'),
      categoryButtons: [...discovery.querySelectorAll('[data-category-button]')],
      availabilityButtons: [...discovery.querySelectorAll('[data-availability]')],
      moreCategories: discovery.querySelector('[data-more-categories]'),
      moreCategoriesPanel: discovery.querySelector('[data-more-categories-panel]'),
      filterCount: discovery.querySelector('[data-filter-count]'),
      counter: discovery.querySelector('[data-catalog-results]'),
      empty: loadControls.querySelector('[data-catalog-empty]'),
      emptyReset: loadControls.querySelector('[data-empty-reset]'),
      loadMore: loadControls.querySelector('[data-load-more]'),
      loadSentinel: loadControls.querySelector('[data-load-sentinel]'),
    };
    syncControlState();
  }

  function installCatalogEvents(grid) {
    const c = state.controls;

    let searchTimer = null;
    c.search?.addEventListener('input', () => {
      applyFilters();
      clearTimeout(searchTimer);
      const searchTerm = String(c.search.value || '').trim();
      if (!searchTerm) return;
      searchTimer = setTimeout(() => {
        window.salePulseTrack?.('SEARCH', {
          ...catalogDiscoveryContext(),
          searchTerm,
        });
      }, 650);
    });

    c.category?.addEventListener('change', () => {
      setCategory(c.category.value);
      applyFilters();
      const category = selectedCategory();
      if (category) window.salePulseTrack?.('CATEGORY_SELECT', {
        ...catalogDiscoveryContext(),
        category,
      });
    });

    [c.condition, c.price, c.sort, c.showSold].forEach((control) => {
      control?.addEventListener('change', () => {
        applyFilters();
        const filters = activeFilters();
        if (Object.keys(filters).length) window.salePulseTrack?.('FILTER_APPLY', {
          ...catalogDiscoveryContext(),
          filters,
        });
      });
    });

    c.categoryButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        setCategory(button.dataset.category || '');
        applyFilters();
        const category = selectedCategory();
        if (category) window.salePulseTrack?.('CATEGORY_SELECT', {
          ...catalogDiscoveryContext(),
          category,
        });
      });
    });

    c.availabilityButtons.forEach((button) => {
      button.addEventListener('click', () => {
        c.availability = button.dataset.availability || 'ALL';
        applyFilters();
        const filters = activeFilters();
        if (Object.keys(filters).length) window.salePulseTrack?.('FILTER_APPLY', {
          ...catalogDiscoveryContext(),
          filters,
        });
      });
    });

    c.moreCategories?.addEventListener('click', () => {
      const expanded = c.moreCategories.getAttribute('aria-expanded') === 'true';
      c.moreCategories.setAttribute('aria-expanded', String(!expanded));
      c.moreCategoriesPanel.hidden = expanded;
    });

    c.loadMore?.addEventListener('click', () => appendNextBatch());
    c.emptyReset?.addEventListener('click', resetCatalogFilters);

    c.reset?.addEventListener('click', resetCatalogFilters);

    function resetCatalogFilters(event) {
      event?.preventDefault();
      c.search.value = '';
      setCategory('');
      c.availability = 'ALL';
      c.condition.value = 'ALL';
      c.price.selectedIndex = 0;
      c.sort.value = 'catalog';
      c.showSold.checked = false;
      applyFilters();
    }

    grid.addEventListener('click', handleProductCardClick);
  }

  function selectedCategory() {
    return String(state.controls.category?.value || '').trim();
  }

  function activeFilters() {
    const c = state.controls;
    const filters = {};
    if (c.availability && c.availability !== 'ALL') filters.availability = c.availability;
    if (c.condition?.value && c.condition.value !== 'ALL') filters.condition = c.condition.value;
    if (c.price?.value && Number(c.price.value) > 0) filters.maxPrice = String(c.price.value);
    if (c.sort?.value && c.sort.value !== 'catalog') filters.sort = c.sort.value;
    if (c.showSold?.checked) filters.showSold = 'true';
    return filters;
  }

  function setCategory(category) {
    const c = state.controls;
    if (c.category) c.category.value = category;
    c.categoryButtons?.forEach((button) => {
      button.classList.toggle('active', (button.dataset.category || '') === category);
    });
    const isMoreCategory = category && [...(c.moreCategoriesPanel?.querySelectorAll('[data-category-button]') || [])]
      .some((button) => button.dataset.category === category);
    if (isMoreCategory) {
      c.moreCategoriesPanel.hidden = false;
      c.moreCategories?.setAttribute('aria-expanded', 'true');
    }
  }

  function syncControlState() {
    const c = state.controls;
    c.categoryButtons?.forEach((button) => {
      button.classList.toggle('active', (button.dataset.category || '') === selectedCategory());
    });
    c.availabilityButtons?.forEach((button) => {
      const active = button.dataset.availability === c.availability;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const advancedCount = [
      c.condition?.value !== 'ALL',
      Boolean(c.price?.value),
      c.sort?.value !== 'catalog',
      Boolean(c.showSold?.checked),
    ].filter(Boolean).length;
    if (c.filterCount) {
      c.filterCount.textContent = advancedCount ? String(advancedCount) : '';
      c.filterCount.hidden = advancedCount === 0;
    }
    const hasAnyFilter = Boolean(
      c.search?.value.trim() || selectedCategory() || c.availability !== 'ALL' || advancedCount
    );
    if (c.reset) c.reset.hidden = !hasAnyFilter;
  }

  function catalogDiscoveryContext(product = null) {
    const context = {
      resultCount: state.filtered.length,
      filters: activeFilters(),
    };
    const category = selectedCategory();
    const searchTerm = String(state.controls.search?.value || '').trim();
    if (category) context.category = category;
    if (searchTerm) context.searchTerm = searchTerm;
    if (product) {
      const position = state.filtered.findIndex((candidate) => candidate.id === product.id);
      if (position >= 0) context.resultPosition = position + 1;
    }
    return context;
  }

  async function handleProductCardClick(event) {
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
        cartButton.disabled = true;
        window.salePulseSetCartContext?.(product, catalogDiscoveryContext(product));
        const added = await window.addStaticCartItem(product.id);
        if (added) cartButton.textContent = 'En carrito';
        else cartButton.disabled = false;
      }
      return;
    }

    const cardLink = event.target.closest('[data-product-card-link]');
    if (cardLink) {
      persistCatalogHistoryState();
      window.salePulseRememberProductDiscovery?.(product, catalogDiscoveryContext(product));
      return;
    }

    event.preventDefault();
    persistCatalogHistoryState();
    window.salePulseRememberProductDiscovery?.(product, catalogDiscoveryContext(product));
    window.location.assign(`/producto/${encodeURIComponent(product.slug)}`);
  }

  function applyFilters(requestedRenderCount = INITIAL_RENDER_COUNT, shouldPersist = true) {
    const c = state.controls;
    const query = normalize(c.search?.value || '');
    const category = normalize(selectedCategory());
    const availability = c.availability || 'ALL';
    const condition = c.condition?.value || 'ALL';
    const maxPrice = Number(c.price?.value || 0);
    const showSold = Boolean(c.showSold?.checked);

    state.filtered = filterProducts(state.products, {
      query,
      category,
      availability,
      condition,
      maxPrice,
      showSold,
    });

    sortProducts(state.filtered);
    const grid = document.querySelector('.product-grid');
    if (grid) {
      grid.innerHTML = '';
      state.renderedCount = 0;
      appendNextBatch(restoredRenderCount(requestedRenderCount, state.filtered.length), false);
    }

    if (c.counter) {
      const noun = state.filtered.length === 1 ? 'artículo' : 'artículos';
      c.counter.textContent = c.showSold?.checked
        ? `${state.filtered.length} ${noun} en el catálogo · incluye vendidos`
        : `${state.filtered.length} ${noun} ${state.filtered.length === 1 ? 'disponible' : 'disponibles'}`;
    }
    syncControlState();
    syncLoadControls();
    if (shouldPersist) persistCatalogHistoryState();
  }

  function filterProducts(products, criteria) {
    const { query, category, availability, condition, maxPrice, showSold } = criteria;
    return products.filter((product) => {
      if (!showSold && product.status !== 'AVAILABLE') return false;
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
        !category || normalize(product.category) === category;

      const availabilityOkay =
        availability === 'ALL' ||
        (availability === 'IMMEDIATE' && product.saleMode === 'IMMEDIATE') ||
        (availability === 'DELAYED' && product.saleMode === 'DELAYED');

      const conditionOkay =
        condition === 'ALL' || conditionBucket(product) === condition;

      const priceOkay =
        !maxPrice || Number(product.askingPricePYG || 0) <= maxPrice;

      return searchOkay && categoryOkay && availabilityOkay && conditionOkay && priceOkay;
    });
  }

  function sortProducts(products, requestedMode = '') {
    const mode = requestedMode || state.controls.sort?.value || 'catalog';
    const availabilityRank = (product) => product.status === 'AVAILABLE' ? 0 : 1;
    const byAvailability = (a, b) => availabilityRank(a) - availabilityRank(b);

    if (mode === 'price-asc') {
      products.sort((a, b) => byAvailability(a, b) || Number(a.askingPricePYG) - Number(b.askingPricePYG) || Number(a.itemNumber) - Number(b.itemNumber));
    } else if (mode === 'price-desc') {
      products.sort((a, b) => byAvailability(a, b) || Number(b.askingPricePYG) - Number(a.askingPricePYG) || Number(a.itemNumber) - Number(b.itemNumber));
    } else if (mode === 'newest') {
      products.sort((a, b) => byAvailability(a, b) || String(b.dateListed || '').localeCompare(String(a.dateListed || '')) || Number(b.itemNumber) - Number(a.itemNumber));
    } else {
      products.sort((a, b) => byAvailability(a, b) || Number(a.itemNumber) - Number(b.itemNumber));
    }
  }

  function appendNextBatch(requestedCount = RENDER_BATCH_SIZE, shouldPersist = true) {
    const grid = document.querySelector('.product-grid');
    if (!grid || state.renderedCount >= state.filtered.length) {
      syncLoadControls();
      return;
    }
    const end = Math.min(state.renderedCount + requestedCount, state.filtered.length);
    const fragment = document.createDocumentFragment();
    state.filtered.slice(state.renderedCount, end).forEach((product) => {
      fragment.appendChild(renderCard(product));
    });
    grid.appendChild(fragment);
    state.renderedCount = end;
    syncLoadControls();
    if (shouldPersist) persistCatalogHistoryState();
  }

  function syncLoadControls() {
    const c = state.controls;
    const remaining = Math.max(0, state.filtered.length - state.renderedCount);
    if (c.loadMore) {
      c.loadMore.hidden = remaining === 0 || state.filtered.length === 0;
      c.loadMore.textContent = remaining
        ? `Cargar más artículos (${remaining} restantes)`
        : 'Todos los artículos están visibles';
    }
    if (c.empty) c.empty.hidden = state.filtered.length !== 0;
    if (c.loadSentinel) c.loadSentinel.hidden = remaining === 0;
  }

  function installContinuousLoading() {
    const sentinel = state.controls.loadSentinel;
    if (!sentinel || typeof IntersectionObserver !== 'function') return;
    state.loadObserver?.disconnect();
    state.loadObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) appendNextBatch();
    }, { rootMargin: '900px 0px' });
    state.loadObserver.observe(sentinel);
  }

  function restoreCatalogScroll(savedScroll, onRestored = () => {}) {
    const targetScroll = Math.max(0, Number(savedScroll) || 0);

    window.requestAnimationFrame(() => {
      while (
        document.documentElement.scrollHeight < targetScroll + window.innerHeight &&
        state.renderedCount < state.filtered.length
      ) {
        appendNextBatch(RENDER_BATCH_SIZE, false);
      }

      window.requestAnimationFrame(() => {
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo({ top: Math.min(targetScroll, maxScroll), left: 0, behavior: 'auto' });
        window.requestAnimationFrame(() => {
          state.restoringCatalog = false;
          persistCatalogHistoryState();
          onRestored();
        });
      });
    });
  }

  function configureBrowserScrollRestoration(path) {
    if (!('scrollRestoration' in window.history)) return;
    const isStorefrontFlow = path === '/' || path === '/index.html' || path === '/carrito' || path.startsWith('/producto/');
    window.history.scrollRestoration = isStorefrontFlow ? 'manual' : 'auto';
  }

  function isPageScrollRoute(path) {
    return path === '/carrito' || path.startsWith('/producto/');
  }

  function pageScrollSnapshot(path, scrollY) {
    return {
      version: PAGE_SCROLL_HISTORY_VERSION,
      path: String(path || ''),
      scrollY: Math.max(0, Number(scrollY) || 0),
    };
  }

  function readPageScrollHistoryState(entryState, path) {
    const saved = entryState?.[PAGE_SCROLL_HISTORY_KEY];
    if (
      !saved ||
      saved.version !== PAGE_SCROLL_HISTORY_VERSION ||
      saved.path !== path
    ) return null;
    return pageScrollSnapshot(saved.path, saved.scrollY);
  }

  function replacePageScrollHistoryState(historyObject, url, snapshot) {
    if (!snapshot || typeof historyObject?.replaceState !== 'function') return;
    const currentState = historyObject.state && typeof historyObject.state === 'object'
      ? historyObject.state
      : {};
    historyObject.replaceState({
      ...currentState,
      [PAGE_SCROLL_HISTORY_KEY]: snapshot,
    }, '', url);
  }

  function persistPageScrollHistoryState() {
    if (
      state.restoringPage ||
      !state.pageScrollPath ||
      cleanPath() !== state.pageScrollPath
    ) return;
    replacePageScrollHistoryState(
      window.history,
      window.location.href,
      pageScrollSnapshot(state.pageScrollPath, state.pageScrollY),
    );
  }

  function restorePageHistoryScroll(snapshot) {
    if (!snapshot) {
      state.restoringPage = false;
      persistPageScrollHistoryState();
      return;
    }

    const targetScroll = snapshot.scrollY;
    let frames = 0;
    const restoreWhenReady = () => {
      frames += 1;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (maxScroll < targetScroll && frames < 120) {
        window.requestAnimationFrame(restoreWhenReady);
        return;
      }

      window.scrollTo({ top: Math.min(targetScroll, maxScroll), left: 0, behavior: 'auto' });
      window.requestAnimationFrame(() => {
        state.pageScrollY = window.scrollY;
        state.restoringPage = false;
        persistPageScrollHistoryState();
      });
    };
    window.requestAnimationFrame(restoreWhenReady);
  }

  function installPageScrollHistoryTracking() {
    if (state.pageScrollTrackingInstalled) return;
    state.pageScrollTrackingInstalled = true;

    const scheduleScrollSave = () => {
      if (state.restoringPage) return;
      clearTimeout(state.pageScrollSaveTimer);
      state.pageScrollSaveTimer = window.setTimeout(() => {
        state.pageScrollSaveTimer = null;
        state.pageScrollY = window.scrollY;
        persistPageScrollHistoryState();
      }, SCROLL_SAVE_DELAY_MS);
    };
    const flushPageScroll = (captureCurrent = true) => {
      clearTimeout(state.pageScrollSaveTimer);
      state.pageScrollSaveTimer = null;
      if (captureCurrent) state.pageScrollY = window.scrollY;
      persistPageScrollHistoryState();
    };

    window.addEventListener('scroll', scheduleScrollSave, { passive: true });
    window.addEventListener('pagehide', () => flushPageScroll(!state.pageLinkNavigation));
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted || !state.pageScrollPath) return;
      const saved = readPageScrollHistoryState(window.history.state, state.pageScrollPath);
      if (!saved) return;
      state.pageLinkNavigation = false;
      state.restoringPage = true;
      restorePageHistoryScroll(saved);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushPageScroll(!state.pageLinkNavigation);
      }
    });
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      state.pageLinkNavigation = true;
      flushPageScroll(false);
    }, true);
  }

  function initializePageScrollRestoration(path) {
    state.pageScrollPath = path;
    const saved = readPageScrollHistoryState(window.history.state, path);
    state.pageScrollY = saved?.scrollY ?? window.scrollY;
    state.restoringPage = Boolean(saved);
    installPageScrollHistoryTracking();
    return saved;
  }

  function restoredRenderCount(savedCount, resultCount) {
    const requested = Number.isFinite(Number(savedCount))
      ? Math.floor(Number(savedCount))
      : INITIAL_RENDER_COUNT;
    return Math.min(resultCount, Math.max(INITIAL_RENDER_COUNT, requested));
  }

  function catalogSnapshotFromValues(values) {
    return {
      version: CATALOG_HISTORY_VERSION,
      search: String(values.search || ''),
      category: String(values.category || ''),
      availability: ['ALL', 'IMMEDIATE', 'DELAYED'].includes(values.availability)
        ? values.availability
        : 'ALL',
      condition: ['ALL', 'EXCELLENT', 'VERY_GOOD', 'GOOD', 'DETAILS'].includes(values.condition)
        ? values.condition
        : 'ALL',
      maxPrice: String(values.maxPrice || ''),
      sort: ['catalog', 'newest', 'price-asc', 'price-desc'].includes(values.sort)
        ? values.sort
        : 'catalog',
      showSold: values.showSold === true,
      renderedCount: Math.max(0, Math.floor(Number(values.renderedCount) || 0)),
      scrollY: Math.max(0, Number(values.scrollY) || 0),
    };
  }

  function captureCatalogHistoryState() {
    if (!state.catalogReady) return null;
    const c = state.controls;
    return catalogSnapshotFromValues({
      search: c.search?.value,
      category: selectedCategory(),
      availability: c.availability,
      condition: c.condition?.value,
      maxPrice: c.price?.value,
      sort: c.sort?.value,
      showSold: c.showSold?.checked,
      renderedCount: state.renderedCount,
      scrollY: window.scrollY,
    });
  }

  function readCatalogHistoryState(entryState) {
    const saved = entryState?.[CATALOG_HISTORY_KEY];
    if (!saved || saved.version !== CATALOG_HISTORY_VERSION) return null;
    return catalogSnapshotFromValues(saved);
  }

  function replaceCatalogHistoryState(historyObject, url, snapshot) {
    if (!snapshot || typeof historyObject?.replaceState !== 'function') return;
    const currentState = historyObject.state && typeof historyObject.state === 'object'
      ? historyObject.state
      : {};
    historyObject.replaceState({
      ...currentState,
      [CATALOG_HISTORY_KEY]: snapshot,
    }, '', url);
  }

  function persistCatalogHistoryState() {
    if (state.restoringCatalog) return;
    const snapshot = captureCatalogHistoryState();
    if (!snapshot) return;
    replaceCatalogHistoryState(window.history, window.location.href, snapshot);
  }

  function restoreCatalogControls(snapshot) {
    const c = state.controls;
    if (c.search) c.search.value = snapshot.search;
    setCategory(snapshot.category);
    c.availability = snapshot.availability;
    if (c.condition) c.condition.value = snapshot.condition;
    if (c.condition?.value !== snapshot.condition) c.condition.value = 'ALL';
    if (c.price) c.price.value = snapshot.maxPrice;
    if (c.price?.value !== snapshot.maxPrice) c.price.value = '';
    if (c.sort) c.sort.value = snapshot.sort;
    if (c.sort?.value !== snapshot.sort) c.sort.value = 'catalog';
    if (c.showSold) c.showSold.checked = snapshot.showSold;
    syncControlState();
  }

  function restoreCatalogState(snapshot, actions) {
    actions.restoreControls(snapshot);
    actions.applyFilters(snapshot.renderedCount);
    actions.restoreScroll(snapshot.scrollY, actions.resumeLoading);
  }

  function installCatalogHistoryTracking() {
    if (state.historyTrackingInstalled) return;
    state.historyTrackingInstalled = true;

    const scheduleScrollSave = () => {
      if (state.restoringCatalog) return;
      clearTimeout(state.scrollSaveTimer);
      state.scrollSaveTimer = window.setTimeout(() => {
        state.scrollSaveTimer = null;
        persistCatalogHistoryState();
      }, SCROLL_SAVE_DELAY_MS);
    };
    const flushCatalogState = () => {
      clearTimeout(state.scrollSaveTimer);
      state.scrollSaveTimer = null;
      persistCatalogHistoryState();
    };

    window.addEventListener('scroll', scheduleScrollSave, { passive: true });
    window.addEventListener('pagehide', flushCatalogState);
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted || !state.catalogReady) return;
      const savedState = readCatalogHistoryState(window.history.state);
      if (!savedState) return;
      state.loadObserver?.disconnect();
      state.restoringCatalog = true;
      restoreCatalogScroll(savedState.scrollY, installContinuousLoading);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushCatalogState();
    });
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      flushCatalogState();
    }, true);
  }

  window.persistCatalogHistoryState = persistCatalogHistoryState;

  function renderCard(product) {
    const article = document.createElement('article');
    article.className = `product-card${product.status !== 'AVAILABLE' ? ' is-sold' : ''}`;
    article.dataset.productId = product.id;
    const detailUrl = `/producto/${encodeURIComponent(product.slug)}`;

    const delayed = product.saleMode === 'DELAYED';
    const available = product.status === 'AVAILABLE';
    const image = product.images?.[0] || '';
    const multiple = Number(product.quantityTotal || 1) > 1;

    article.innerHTML = `
      <a class="product-card-link" href="${detailUrl}" data-product-card-link aria-label="Ver detalles de ${escapeAttr(product.title)}"></a>
      <div class="product-photo" aria-hidden="true">
        ${image ? `<img src="${escapeAttr(window.imageDelivery.resolve(image))}" data-original-src="${escapeAttr(window.imageDelivery.original(image))}" alt="" loading="lazy" decoding="async">` : ''}
        ${!available ? '<span class="sold-ribbon">VENDIDO</span>' : ''}
      </div>
      <div class="product-copy">
        <span class="item-number">Item ${String(product.itemNumber).padStart(3, '0')}</span>
        <h3>${escapeHtml(product.title)}</h3>
        <strong class="price">${formatMoney(product.askingPricePYG)}${multiple ? ' por unidad' : ''}</strong>
        <div class="card-detail-row">
          <span class="card-detail-link">Ver detalle</span>
          <span class="card-category">${escapeHtml(product.category || '')}</span>
        </div>
        <div class="card-actions">
          <button type="button" data-cart-action ${!available ? 'disabled' : ''}>
            ${!available ? 'No disponible' : 'Agregar al carrito'}
          </button>
        </div>
        <div class="card-availability">
          <span class="${!available ? 'status-unavailable' : delayed ? 'status-later' : 'status-now'}">
            ${!available ? 'VENDIDO' : delayed ? 'RETIRO 9–12 DIC.' : 'DISPONIBLE AHORA'}
          </span>
          ${delayed && available ? `<span class="deposit-note">Seña ${Number(product.depositPercent || 25)}%</span>` : ''}
        </div>
      </div>
    `;

    return article;
  }

  function conditionBucket(product) {
    const raw = `${product.condition || ''} ${product.conditionNotes || ''}`.trim();

    if (
      !raw ||
      /estado visual\s+seg[uú]n\s+(?:las\s+)?fotograf[ií]as?/i.test(raw)
    ) {
      return '';
    }

    const text = normalize(raw);

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

  function enhanceDetailPhotoAction() {
    const main =
      document.querySelector('.main-image');

    if (!main) {
      return;
    }

    main.setAttribute(
      'aria-label',
      'Ver foto(s)'
    );

    if (
      !main.querySelector(
        '.image-enlarge-hint'
      )
    ) {
      const hint =
        document.createElement('span');

      hint.className =
        'image-enlarge-hint';

      hint.textContent =
        'Ver foto(s)';

      main.appendChild(hint);
    }
  }


  function installDetailLightbox() {
    document.addEventListener(
      'click',
      (event) => {
        const trigger =
          event.target.closest(
            '.product-photo-teaser button, .main-image, .product-gallery-thumbnails button'
          );

        if (!trigger) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        const renderedImages =
          [
            ...document.querySelectorAll(
              '.product-gallery img'
            ),
          ]
            .map(
              (img) =>
                img.getAttribute('data-original-src') ||
                img.getAttribute('src') ||
                img.currentSrc ||
                ''
            )
            .filter(Boolean);

        const images =
          [
            ...new Set(
              renderedImages.map(
                withLeadingSlash
              )
            ),
          ];

        if (!images.length) {
          return;
        }

        const clickedImage =
          trigger.querySelector('img');

        const clickedSrc =
          withLeadingSlash(
            clickedImage?.getAttribute('data-original-src') ||
            clickedImage?.getAttribute(
              'src'
            ) ||
            clickedImage?.currentSrc ||
            ''
          );

        let initialIndex =
          images.findIndex(
            (src) =>
              src === clickedSrc
          );

        if (initialIndex < 0) {
          initialIndex = 0;
        }

        createLightbox(images, initialIndex, {
          opener: trigger,
        });
      },
      true
    );
  }

  function createLightbox(images, initialIndex, options = {}) {
    const clean =
      [
        ...new Set(
          images
            .map(withLeadingSlash)
            .filter(Boolean)
        ),
      ];

    if (!clean.length) {
      return;
    }

    let index =
      Math.max(
        0,
        Math.min(
          initialIndex || 0,
          clean.length - 1
        )
      );

    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let dragging = false;
    let dragStart = null;
    let pinchStart = null;
    const pointers = new Map();
    const returnScrollY = window.scrollY;
    const opener = options.opener instanceof HTMLElement
      ? options.opener
      : document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;

    const box =
      document.createElement('div');

    box.className =
      'catalog-lightbox';

    box.innerHTML = `
      <div
        class="catalog-lightbox-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Fotos del artículo"
      >
        <header>
          <strong>Fotos del artículo</strong>
          <span data-count></span>

          <button
            type="button"
            class="catalog-lightbox-close"
            data-close
            aria-label="Cerrar fotos"
            title="Cerrar"
          >
            ×
          </button>
        </header>

        <div class="catalog-lightbox-stage">
          <button
            type="button"
            data-prev
            aria-label="Foto anterior"
            ${clean.length === 1 ? 'disabled' : ''}
          >
            ‹
          </button>

          <div
            class="catalog-lightbox-canvas"
            data-canvas
          >
            <img
              data-image
              alt=""
              draggable="false"
            >
          </div>

          <button
            type="button"
            data-next
            aria-label="Foto siguiente"
            ${clean.length === 1 ? 'disabled' : ''}
          >
            ›
          </button>
        </div>

        ${
          clean.length > 1
            ? `
              <div
                class="catalog-lightbox-thumbs"
                data-thumbs
                aria-label="Miniaturas de fotos"
              ></div>
            `
            : ''
        }

        <footer>
          <button
            type="button"
            data-out
            aria-label="Alejar"
          >
            −
          </button>

          <strong data-zoom>
            100%
          </strong>

          <button
            type="button"
            data-in
            aria-label="Acercar"
          >
            +
          </button>

          <button
            type="button"
            data-reset
          >
            Restablecer
          </button>

          ${
            options.detailUrl
              ? `<a class="catalog-lightbox-detail" href="${escapeAttr(options.detailUrl)}">Ver detalles del artículo</a>`
              : ''
          }

          <span>
            Pellizcá o usá +/− para ampliar · arrastrá para mover
          </span>
        </footer>
      </div>
    `;

    document.body.appendChild(box);
    document.body.style.overflow = 'hidden';

    const canvas =
      box.querySelector(
        '[data-canvas]'
      );

    const image =
      box.querySelector(
        '[data-image]'
      );

    const count =
      box.querySelector(
        '[data-count]'
      );

    const label =
      box.querySelector(
        '[data-zoom]'
      );

    const thumbs =
      box.querySelector(
        '[data-thumbs]'
      );

    let baseW = 0;
    let baseH = 0;

    if (thumbs) {
      thumbs.innerHTML =
        clean
          .map(
            (src, thumbIndex) => `
              <button
                type="button"
                data-thumb="${thumbIndex}"
                aria-label="Ver foto ${thumbIndex + 1}"
              >
                <img
                  src="${escapeAttr(window.imageDelivery.resolve(src))}"
                  data-original-src="${escapeAttr(window.imageDelivery.original(src))}"
                  alt=""
                  draggable="false"
                  decoding="async"
                >
              </button>
            `
          )
          .join('');

      thumbs
        .querySelectorAll(
          '[data-thumb]'
        )
        .forEach(
          (button) => {
            button.addEventListener(
              'click',
              () => {
                index =
                  Number(
                    button.getAttribute(
                      'data-thumb'
                    )
                  );

                show();
              }
            );
          }
        );
    }

    function fit() {
      if (
        !image.naturalWidth ||
        !image.naturalHeight
      ) {
        return;
      }

      const scale =
        Math.min(
          (
            canvas.clientWidth -
            24
          ) /
            image.naturalWidth,
          (
            canvas.clientHeight -
            24
          ) /
            image.naturalHeight,
          1
        );

      baseW =
        image.naturalWidth *
        scale;

      baseH =
        image.naturalHeight *
        scale;

      panX = 0;
      panY = 0;
      setZoom(1);
    }

    function clampPan() {
      const maxX = Math.max(
        0,
        (baseW * zoom - canvas.clientWidth) / 2
      );
      const maxY = Math.max(
        0,
        (baseH * zoom - canvas.clientHeight) / 2
      );

      panX = Math.max(-maxX, Math.min(maxX, panX));
      panY = Math.max(-maxY, Math.min(maxY, panY));
    }

    function renderZoom() {
      clampPan();

      image.style.width = `${Math.round(baseW * zoom)}px`;
      image.style.height = `${Math.round(baseH * zoom)}px`;
      image.style.maxWidth = 'none';
      image.style.maxHeight = 'none';
      image.style.left = '50%';
      image.style.top = '50%';
      image.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`;

      label.textContent = `${Math.round(zoom * 100)}%`;
      canvas.classList.toggle('can-pan', zoom > 1);
    }

    function setZoom(next, focalPoint) {
      const previousZoom = zoom;
      const nextZoom =
        Math.max(
          1,
          Math.min(
            4,
            next
          )
        );

      if (focalPoint && previousZoom > 0 && nextZoom !== previousZoom) {
        const focalX = focalPoint.x - canvas.clientWidth / 2;
        const focalY = focalPoint.y - canvas.clientHeight / 2;
        const ratio = nextZoom / previousZoom;
        panX = focalX - (focalX - panX) * ratio;
        panY = focalY - (focalY - panY) * ratio;
      }

      zoom = nextZoom;

      if (zoom === 1) {
        panX = 0;
        panY = 0;
      }

      renderZoom();
    }

    function show() {
      zoom = 1;
      panX = 0;
      panY = 0;

      image.src =
        clean[index];
      image.alt = `Foto ${index + 1} de ${clean.length}`;

      count.textContent =
        `${index + 1} de ${clean.length}`;

      if (thumbs) {
        thumbs
          .querySelectorAll(
            '[data-thumb]'
          )
          .forEach(
            (button) => {
              const active =
                Number(
                  button.getAttribute(
                    'data-thumb'
                  )
                ) === index;

              button.classList.toggle(
                'is-active',
                active
              );

              button.setAttribute(
                'aria-current',
                active
                  ? 'true'
                  : 'false'
              );
            }
          );

        const activeThumb =
          thumbs.querySelector(
            '.is-active'
          );

        activeThumb?.scrollIntoView({
          block: 'nearest',
          inline: 'center',
        });
      }
    }

    function move(delta) {
      index =
        (
          index +
          delta +
          clean.length
        ) %
        clean.length;

      show();
    }

    function close() {
      pointers.clear();
      document.body.style.overflow = previousBodyOverflow;
      box.remove();

      document.removeEventListener(
        'keydown',
        keys
      );

      window.scrollTo(0, returnScrollY);
      window.requestAnimationFrame(() => {
        if (opener instanceof HTMLElement && opener.isConnected) {
          opener.focus({ preventScroll: true });
        }
      });
    }

    function keys(event) {
      if (
        event.key === 'Escape'
      ) {
        close();
      }

      if (
        event.key ===
        'ArrowLeft'
      ) {
        move(-1);
      }

      if (
        event.key ===
        'ArrowRight'
      ) {
        move(1);
      }
    }

    image.addEventListener(
      'load',
      fit
    );

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();

        const rect = canvas.getBoundingClientRect();

        setZoom(
          zoom +
          (
            event.deltaY < 0
              ? .2
              : -.2
          ),
          {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }
        );
      },
      {
        passive: false,
      }
    );

    canvas.addEventListener(
      'pointerdown',
      (event) => {
        canvas.setPointerCapture(
          event.pointerId
        );

        pointers.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });

        if (pointers.size >= 2) {
          const [first, second] = [...pointers.values()];
          const rect = canvas.getBoundingClientRect();
          const centerX = (first.x + second.x) / 2 - rect.left;
          const centerY = (first.y + second.y) / 2 - rect.top;

          pinchStart = {
            distance: Math.hypot(second.x - first.x, second.y - first.y) || 1,
            zoom,
            imageX: (centerX - canvas.clientWidth / 2 - panX) / zoom,
            imageY: (centerY - canvas.clientHeight / 2 - panY) / zoom,
          };
          dragging = false;
          dragStart = null;
          canvas.classList.remove('dragging');
          return;
        }

        if (zoom <= 1) return;

        dragging = true;
        dragStart = {
          x: event.clientX,
          y: event.clientY,
          panX,
          panY,
        };

        canvas.classList.add(
          'dragging'
        );
      }
    );

    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (!pointers.has(event.pointerId)) {
          return;
        }

        pointers.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });

        if (pointers.size >= 2 && pinchStart) {
          const [first, second] = [...pointers.values()];
          const rect = canvas.getBoundingClientRect();
          const centerX = (first.x + second.x) / 2 - rect.left;
          const centerY = (first.y + second.y) / 2 - rect.top;
          const distance = Math.hypot(
            second.x - first.x,
            second.y - first.y
          );

          zoom = Math.max(
            1,
            Math.min(4, pinchStart.zoom * distance / pinchStart.distance)
          );
          panX = centerX - canvas.clientWidth / 2 - pinchStart.imageX * zoom;
          panY = centerY - canvas.clientHeight / 2 - pinchStart.imageY * zoom;
          renderZoom();
          return;
        }

        if (!dragging || !dragStart) return;

        panX = dragStart.panX + event.clientX - dragStart.x;
        panY = dragStart.panY + event.clientY - dragStart.y;
        renderZoom();
      }
    );

    function endPointer(event) {
      pointers.delete(event.pointerId);

      if (pointers.size < 2) {
        pinchStart = null;
      }

      if (pointers.size === 1 && zoom > 1) {
        const remaining = [...pointers.values()][0];
        dragging = true;
        dragStart = {
          x: remaining.x,
          y: remaining.y,
          panX,
          panY,
        };
        canvas.classList.add('dragging');
      } else {
        dragging = false;
        dragStart = null;
        canvas.classList.remove('dragging');
      }

      if (zoom === 1) {
        panX = 0;
        panY = 0;
        renderZoom();
      }
    }

    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    image.addEventListener(
      'dblclick',
      (event) => {
        const rect = canvas.getBoundingClientRect();
        setZoom(
          zoom === 1
            ? 2
            : 1,
          {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }
        );
      }
    );

    box
      .querySelector(
        '[data-close]'
      )
      .addEventListener(
        'click',
        close
      );

    box
      .querySelector(
        '[data-prev]'
      )
      .addEventListener(
        'click',
        () => move(-1)
      );

    box
      .querySelector(
        '[data-next]'
      )
      .addEventListener(
        'click',
        () => move(1)
      );

    box
      .querySelector(
        '[data-in]'
      )
      .addEventListener(
        'click',
        () =>
          setZoom(
            zoom + .25
          )
      );

    box
      .querySelector(
        '[data-out]'
      )
      .addEventListener(
        'click',
        () =>
          setZoom(
            zoom - .25
          )
      );

    box
      .querySelector(
        '[data-reset]'
      )
      .addEventListener(
        'click',
        () => setZoom(1)
      );

    box.addEventListener(
      'click',
      (event) => {
        if (
          event.target === box
        ) {
          close();
        }
      }
    );

    document.addEventListener(
      'keydown',
      keys
    );

    show();
  }

  function installStyles() {
    if (document.getElementById('unified-catalog-styles')) return;
    const style = document.createElement('style');
    style.id = 'unified-catalog-styles';
    style.textContent = `
      .search-panel{display:block!important;margin:25px 0 14px!important}
      .search-panel .catalog-search-label{display:block;max-width:760px;min-width:0;margin:0;padding:0;border:0;background:transparent}
      .search-panel .catalog-search-label>span{display:block;margin:0 0 8px;color:var(--ink);font-family:Georgia,serif;font-size:clamp(22px,3vw,30px);font-weight:600;letter-spacing:-.02em;text-transform:none;transform:none}
      .search-panel .catalog-search-label input{display:block;box-sizing:border-box;min-width:0;width:100%;height:54px;padding:0 16px;border:2px solid var(--forest);border-radius:9px;background:#fff;color:var(--ink);font:inherit;font-size:16px;outline:none}
      .search-panel .catalog-search-label input:focus{box-shadow:0 0 0 3px rgba(35,81,62,.14)}
      .search-panel .catalog-search-label small{display:block;margin-top:6px;color:var(--muted);font-size:12px}
      .catalog-discovery{margin-bottom:20px}
      .category-prompt{margin:20px 0 9px;color:var(--ink);font-family:Georgia,serif;font-size:20px;font-weight:600}
      .category-row{display:flex!important;flex-wrap:wrap!important;gap:8px!important;overflow:visible!important;padding:0!important}
      .category-row button,.availability-row button{min-height:44px;padding:9px 15px;border:1px solid #c9c3b7;border-radius:999px;background:#fff;color:var(--forest);font-size:13px;font-weight:750;cursor:pointer}
      .category-row button.active,.availability-row button.active{border-color:var(--forest);background:var(--forest);color:#fff}
      .category-row .more-categories-toggle{border-style:dashed;background:#f8f5ee}
      .more-categories-panel{margin:12px 0 0;padding:14px;border:1px solid var(--line);border-radius:10px;background:#fff}
      .more-categories-panel[hidden]{display:none}
      .more-categories-panel>p{margin:0 0 10px;color:var(--muted);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
      .availability-choices{margin:20px 0 0;padding:0;border:0}
      .availability-choices legend{margin-bottom:9px;color:var(--ink);font-size:13px;font-weight:800}
      .availability-row{display:flex;flex-wrap:wrap;gap:8px}
      .catalog-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:20px;padding-top:16px;border-top:1px solid var(--line)}
      .catalog-toolbar>strong{color:var(--forest);font-size:15px}
      .more-filters{position:relative;margin-left:auto}
      .more-filters summary{display:flex;align-items:center;gap:7px;min-height:44px;padding:0 15px;border:1px solid var(--forest);border-radius:8px;background:#fff;color:var(--forest);font-size:13px;font-weight:800;cursor:pointer;list-style:none}
      .more-filters summary::-webkit-details-marker{display:none}
      .more-filters summary span{display:grid;place-items:center;min-width:22px;height:22px;border-radius:999px;background:var(--clay);color:#fff;font-size:11px}
      .advanced-filter-grid{position:absolute;right:0;z-index:20;display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:12px;width:min(620px,calc(100vw - 40px));margin-top:8px;padding:16px;border:1px solid var(--line);border-radius:10px;background:#fff;box-shadow:0 18px 40px rgba(35,51,44,.18)}
      .advanced-filter-grid label>span{display:block;margin:0 0 5px;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}
      .advanced-filter-grid select{width:100%;min-height:44px;padding:0 32px 0 10px;border:1px solid var(--line);border-radius:8px;background:#fff}
      .advanced-filter-grid .show-sold-option{display:flex;align-items:center;gap:9px;min-height:44px}
      .advanced-filter-grid .show-sold-option>span{margin:0;color:var(--ink);font-size:13px;text-transform:none}
      .show-sold-option input{width:20px;height:20px}
      .catalog-load-controls{display:grid;justify-items:center;min-height:20px;margin-top:22px}
      .catalog-load-controls button{min-height:48px;padding:0 20px;border:2px solid var(--forest);border-radius:8px;background:#fff;color:var(--forest);font-size:14px;font-weight:850;cursor:pointer}
      .catalog-load-controls button[hidden],.catalog-load-controls [hidden]{display:none}
      .catalog-load-controls [data-load-sentinel]{width:100%;height:1px}
      .product-card{position:relative;cursor:pointer;transform:none!important;background:#fff!important;transition:border-color .18s ease,box-shadow .18s ease}
      .product-card:hover,.product-card:focus-within{transform:none!important;box-shadow:0 10px 24px rgba(35,51,44,.13)!important;background:#fff!important;border-color:var(--forest)!important}
      .product-card img,.product-card:hover img,.product-photo:hover img{transform:none!important;transition:none!important}
      .product-card-link{position:absolute;inset:0;z-index:1;border-radius:inherit;cursor:pointer}
      .product-card-link:focus-visible{outline:3px solid var(--clay);outline-offset:-4px}
      .product-card .card-actions{position:relative;z-index:2}
      .card-actions button{position:relative;z-index:2;cursor:pointer!important}
      .reset-filters,.reset-filters:hover,.reset-filters:focus,.reset-filters:active{color:var(--forest)!important;background:transparent!important;border-color:var(--line)!important;box-shadow:none!important}
      .back-to-top{display:inline-flex;align-items:center;gap:6px;margin-top:20px;color:var(--forest);font-size:12px;font-weight:800;text-decoration:none}
      .back-to-top:hover,.back-to-top:focus{text-decoration:underline}
      @media (max-width:620px){.catalog-toolbar{align-items:flex-start;flex-direction:column}.more-filters{width:100%;margin-left:0}.more-filters summary{justify-content:center;width:100%}.advanced-filter-grid{position:static;grid-template-columns:1fr;width:100%;box-shadow:none}.category-row button,.availability-row button{min-height:46px;padding-inline:14px}.catalog-toolbar>strong{font-size:14px}}
      .catalog-lightbox{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:18px;background:rgba(3,10,7,.95)}
      .catalog-lightbox-dialog{width:min(1450px,100%);height:min(920px,calc(100vh - 36px));display:grid;grid-template-rows:auto minmax(0,1fr) auto auto;overflow:hidden;color:#fff;background:#151a17;border:1px solid rgba(255,255,255,.18);border-radius:12px}
      .catalog-lightbox header{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-bottom:1px solid rgba(255,255,255,.15)}
      .catalog-lightbox button{min-height:40px;border:1px solid rgba(255,255,255,.4);border-radius:8px;background:#252c28;color:#fff;font-weight:800;cursor:pointer}
      .catalog-lightbox button:disabled{opacity:.3;cursor:default}
      .catalog-lightbox .catalog-lightbox-close{width:52px;height:52px;min-height:52px;padding:0;font-size:30px;line-height:1;display:grid;place-items:center}
      .catalog-lightbox-stage{min-height:0;display:grid;grid-template-columns:54px minmax(0,1fr) 54px;gap:8px;padding:12px}
      .catalog-lightbox-stage>button{align-self:center;width:48px;font-size:30px}
      .catalog-lightbox-canvas{min-width:0;min-height:0;overflow:hidden;position:relative;background:#0c100e;border-radius:8px;cursor:zoom-in;touch-action:none;overscroll-behavior:contain}
      .catalog-lightbox-canvas.can-pan{cursor:grab}.catalog-lightbox-canvas.dragging{cursor:grabbing}
      .catalog-lightbox-canvas img{display:block;position:absolute;object-fit:contain;user-select:none;will-change:width,height,transform}
      .catalog-lightbox-thumbs{display:flex;gap:10px;overflow-x:auto;padding:10px 14px;border-top:1px solid rgba(255,255,255,.12);background:#111612}
      .catalog-lightbox-thumbs button{flex:0 0 auto;width:78px;height:78px;min-height:78px;padding:4px;border:2px solid transparent;background:#252c28}
      .catalog-lightbox-thumbs button.is-active{border-color:#fff}
      .catalog-lightbox-thumbs img{width:100%;height:100%;object-fit:cover;border-radius:4px;display:block}
      .catalog-lightbox footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,.15)}
      .catalog-lightbox footer button{padding:4px 12px}.catalog-lightbox footer span{color:#c7d0cb;font-size:12px}
      .catalog-lightbox-detail{display:inline-grid;place-items:center;min-height:40px;padding:4px 14px;border:1px solid #fff;border-radius:8px;background:#fff;color:#153d2f;font-weight:850}
      .main-image{position:relative!important;cursor:zoom-in!important}
      .main-image .image-enlarge-hint{position:absolute;right:12px;bottom:12px;z-index:2}
      .product-gallery-thumbnails button{cursor:zoom-in!important}
      @media (max-width:700px){.catalog-lightbox{padding:0}.catalog-lightbox-dialog{width:100%;height:100dvh;border:0;border-radius:0}.catalog-lightbox-stage{grid-template-columns:42px minmax(0,1fr) 42px;gap:3px;padding:6px}.catalog-lightbox-stage>button{width:40px;min-height:52px;padding:0}.catalog-lightbox-thumbs{padding:7px 10px}.catalog-lightbox-thumbs button{width:64px;height:58px;min-height:58px}.catalog-lightbox footer{gap:7px;padding:8px 10px}.catalog-lightbox footer>span{flex-basis:100%;text-align:center}.catalog-lightbox-detail{order:2}.catalog-lightbox footer>span{order:3}}
      @media (max-height:520px) and (orientation:landscape){.catalog-lightbox header{padding:4px 8px 4px 12px}.catalog-lightbox .catalog-lightbox-close{width:42px;height:42px;min-height:42px}.catalog-lightbox-thumbs{display:none}.catalog-lightbox footer{padding:5px 8px}.catalog-lightbox footer>span{display:none}}
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
