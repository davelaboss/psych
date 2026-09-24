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
      installStyles();

      const catalog = await fetchCatalog();
      state.products = dedupe(catalog)
        .sort((a, b) => Number(a.itemNumber) - Number(b.itemNumber));

      window.__catalogProducts = state.products;

      const path = cleanPath();

      if (path.startsWith('/producto/')) {
        const slug = decodeURIComponent(path.slice('/producto/'.length));
        const product = state.products.find((item) => item.slug === slug);

        if (product && typeof window.renderProductDetail === 'function') {
          window.renderProductDetail(product);
        }

        enhanceDetailPhotoAction();
        installDetailLightbox();
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

  async function fetchCatalog() {
    const response = await fetch('/.netlify/functions/volume2-catalog', {
      cache: 'no-store',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'No se pudo cargar el catálogo.');
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
    buildDelayedShelf();

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

    grid.addEventListener('click', handleProductCardClick);
  }

  function handleProductCardClick(event) {
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
  }

  function buildDelayedShelf() {
    const shelf = document.querySelector('[data-delayed-shelf]');
    const track = shelf?.querySelector('.shelf-grid');
    const heading = shelf?.querySelector('.shelf-heading');

    if (!shelf || !track || !heading) return;

    const products = state.products
      .filter(
        (product) =>
          product.status === 'AVAILABLE' &&
          product.saleMode === 'DELAYED'
      )
      .sort((a, b) => Number(a.itemNumber) - Number(b.itemNumber));

    track.innerHTML = '';

    products.forEach((product) => {
      const card = renderCard(product);
      card.classList.add('compact');
      track.appendChild(card);
    });

    if (track.dataset.catalogEventsBound !== 'true') {
      track.addEventListener('click', handleProductCardClick);
      track.dataset.catalogEventsBound = 'true';
    }

    let meta = shelf.querySelector('[data-delayed-meta]');

    if (!meta) {
      meta = document.createElement('div');
      meta.dataset.delayedMeta = 'true';
      meta.className = 'delayed-shelf-meta';
      heading.appendChild(meta);
    }

    meta.innerHTML = `
      <strong>${products.length} artículos con retiro posterior</strong>
      <div class="delayed-shelf-controls" aria-label="Navegar artículos con retiro posterior">
        <button type="button" data-delayed-prev aria-label="Artículo anterior">←</button>
        <span data-delayed-position aria-live="polite"></span>
        <button type="button" data-delayed-next aria-label="Artículo siguiente">→</button>
      </div>
    `;

    const cards = [...track.querySelectorAll('.product-card')];
    const prev = meta.querySelector('[data-delayed-prev]');
    const next = meta.querySelector('[data-delayed-next]');
    const position = meta.querySelector('[data-delayed-position]');

    let currentIndex = 0;
    let scrollFrame = null;

    function syncControls() {
      if (!cards.length) {
        position.textContent = '0 de 0';
        prev.disabled = true;
        next.disabled = true;
        return;
      }

      currentIndex = Math.max(
        0,
        Math.min(currentIndex, cards.length - 1)
      );

      position.textContent = `${currentIndex + 1} de ${cards.length}`;
      prev.disabled = currentIndex === 0;
      next.disabled = currentIndex === cards.length - 1;
    }

    function goTo(index) {
      if (!cards.length) return;

      currentIndex = Math.max(
        0,
        Math.min(index, cards.length - 1)
      );

      const trackBox = track.getBoundingClientRect();
      const cardBox = cards[currentIndex].getBoundingClientRect();

      track.scrollTo({
        left: track.scrollLeft + cardBox.left - trackBox.left,
        behavior: 'smooth',
      });

      syncControls();
    }

    prev.addEventListener('click', () => goTo(currentIndex - 1));
    next.addEventListener('click', () => goTo(currentIndex + 1));

    track.addEventListener(
      'scroll',
      () => {
        if (scrollFrame !== null) {
          window.cancelAnimationFrame(scrollFrame);
        }

        scrollFrame = window.requestAnimationFrame(() => {
          scrollFrame = null;

          if (!cards.length) return;

          let nearestIndex = 0;
          let nearestDistance = Infinity;
          const trackLeft = track.getBoundingClientRect().left;

          cards.forEach((card, index) => {
            const distance = Math.abs(
              card.getBoundingClientRect().left - trackLeft
            );

            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestIndex = index;
            }
          });

          currentIndex = nearestIndex;
          syncControls();
        });
      },
      { passive: true }
    );

    syncControls();
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
            '.main-image, .product-gallery-thumbnails button'
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

        createLightbox(
          images,
          initialIndex
        );
      },
      true
    );
  }

  function createLightbox(images, initialIndex) {
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
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let scrollX = 0;
    let scrollY = 0;

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

          <span>
            Rueda del mouse para zoom · arrastrá para mover
          </span>
        </footer>
      </div>
    `;

    document.body.appendChild(box);

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
                  src="${escapeAttr(src)}"
                  alt=""
                  draggable="false"
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

      setZoom(1);
    }

    function setZoom(next) {
      zoom =
        Math.max(
          1,
          Math.min(
            4,
            next
          )
        );

      image.style.width =
        `${Math.round(
          baseW * zoom
        )}px`;

      image.style.height =
        `${Math.round(
          baseH * zoom
        )}px`;

      image.style.maxWidth =
        'none';

      image.style.maxHeight =
        'none';

      label.textContent =
        `${Math.round(
          zoom * 100
        )}%`;

      canvas.classList.toggle(
        'can-pan',
        zoom > 1
      );

      if (zoom === 1) {
        canvas.scrollLeft = 0;
        canvas.scrollTop = 0;
      }
    }

    function show() {
      zoom = 1;

      image.src =
        clean[index];

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
      box.remove();

      document.removeEventListener(
        'keydown',
        keys
      );
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

        setZoom(
          zoom +
          (
            event.deltaY < 0
              ? .2
              : -.2
          )
        );
      },
      {
        passive: false,
      }
    );

    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (zoom <= 1) {
          return;
        }

        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        scrollX = canvas.scrollLeft;
        scrollY = canvas.scrollTop;

        canvas.setPointerCapture(
          event.pointerId
        );

        canvas.classList.add(
          'dragging'
        );
      }
    );

    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (!dragging) {
          return;
        }

        canvas.scrollLeft =
          scrollX -
          (
            event.clientX -
            startX
          );

        canvas.scrollTop =
          scrollY -
          (
            event.clientY -
            startY
          );
      }
    );

    canvas.addEventListener(
      'pointerup',
      () => {
        dragging = false;

        canvas.classList.remove(
          'dragging'
        );
      }
    );

    image.addEventListener(
      'dblclick',
      () =>
        setZoom(
          zoom === 1
            ? 2
            : 1
        )
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
      [data-delayed-shelf] .shelf-heading{display:flex!important;align-items:flex-end!important;justify-content:space-between!important;gap:24px!important;flex-wrap:wrap!important}
      .delayed-shelf-meta{display:flex;align-items:center;justify-content:flex-end;gap:14px;flex-wrap:wrap}
      .delayed-shelf-meta>strong{font-size:13px;color:var(--forest)}
      .delayed-shelf-controls{display:flex;align-items:center;gap:8px}
      .delayed-shelf-controls button{width:42px;height:42px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--forest);font-size:20px;font-weight:800;cursor:pointer}
      .delayed-shelf-controls button:disabled{opacity:.35;cursor:default}
      .delayed-shelf-controls span{min-width:62px;text-align:center;font-size:12px;font-weight:800;color:var(--muted)}
      [data-delayed-shelf] .shelf-grid{display:grid!important;grid-template-columns:none!important;grid-auto-flow:column!important;grid-auto-columns:minmax(260px,320px)!important;gap:16px!important;overflow-x:auto!important;overscroll-behavior-inline:contain;scroll-snap-type:x mandatory;scroll-padding-inline:2px;padding:4px 2px 14px!important}
      [data-delayed-shelf] .shelf-grid>.product-card{scroll-snap-align:start;min-width:0}
      .back-to-top{display:inline-flex;align-items:center;gap:6px;margin-top:20px;color:var(--forest);font-size:12px;font-weight:800;text-decoration:none}
      .back-to-top:hover,.back-to-top:focus{text-decoration:underline}
      @media (max-width:700px){[data-delayed-shelf] .shelf-heading{align-items:flex-start!important}.delayed-shelf-meta{width:100%;justify-content:space-between}[data-delayed-shelf] .shelf-grid{grid-auto-columns:minmax(82vw,82vw)!important}}
      .catalog-lightbox{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:18px;background:rgba(3,10,7,.95)}
      .catalog-lightbox-dialog{width:min(1450px,100%);height:min(920px,calc(100vh - 36px));display:grid;grid-template-rows:auto minmax(0,1fr) auto auto;overflow:hidden;color:#fff;background:#151a17;border:1px solid rgba(255,255,255,.18);border-radius:12px}
      .catalog-lightbox header{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-bottom:1px solid rgba(255,255,255,.15)}
      .catalog-lightbox button{min-height:40px;border:1px solid rgba(255,255,255,.4);border-radius:8px;background:#252c28;color:#fff;font-weight:800;cursor:pointer}
      .catalog-lightbox .catalog-lightbox-close{width:52px;height:52px;min-height:52px;padding:0;font-size:30px;line-height:1;display:grid;place-items:center}
      .catalog-lightbox-stage{min-height:0;display:grid;grid-template-columns:54px minmax(0,1fr) 54px;gap:8px;padding:12px}
      .catalog-lightbox-stage>button{align-self:center;width:48px;font-size:30px}
      .catalog-lightbox-canvas{min-width:0;min-height:0;overflow:auto;display:grid;place-items:center;background:#0c100e;border-radius:8px;cursor:zoom-in;touch-action:none}
      .catalog-lightbox-canvas.can-pan{cursor:grab}.catalog-lightbox-canvas.dragging{cursor:grabbing}
      .catalog-lightbox-canvas img{display:block;object-fit:contain;user-select:none}
      .catalog-lightbox-thumbs{display:flex;gap:10px;overflow-x:auto;padding:10px 14px;border-top:1px solid rgba(255,255,255,.12);background:#111612}
      .catalog-lightbox-thumbs button{flex:0 0 auto;width:78px;height:78px;min-height:78px;padding:4px;border:2px solid transparent;background:#252c28}
      .catalog-lightbox-thumbs button.is-active{border-color:#fff}
      .catalog-lightbox-thumbs img{width:100%;height:100%;object-fit:cover;border-radius:4px;display:block}
      .catalog-lightbox footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,.15)}
      .catalog-lightbox footer button{padding:4px 12px}.catalog-lightbox footer span{color:#c7d0cb;font-size:12px}
      .main-image{position:relative!important;cursor:zoom-in!important}
      .main-image .image-enlarge-hint{position:absolute;right:12px;bottom:12px;z-index:2}
      .product-gallery-thumbnails button{cursor:zoom-in!important}
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
