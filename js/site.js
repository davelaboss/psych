// File: js/site.js
// Run static routing after the old generated app has completely finished loading.
window.addEventListener('load', function () {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (!path.startsWith('/producto/')) {
    return;
  }

  const slug = decodeURIComponent(path.slice('/producto/'.length));
  const product = getEmbeddedProduct(slug);

  if (!product) {
    console.error('No se encontró el producto:', slug);
    return;
  }

  renderProductDetail(product);
});


    function getEmbeddedProduct(slug) {
      const html = document.documentElement.innerHTML;
      const marker = '\\"slug\\":\\"' + slug + '\\"';

      const markerIndex = html.indexOf(marker);

      if (markerIndex === -1) {
        return null;
      }

      const start = html.lastIndexOf('{\\"id\\":', markerIndex);

      if (start === -1) {
        return null;
      }

      const nextProduct = html.indexOf('},{\\"id\\":', markerIndex);

      if (nextProduct === -1) {
        return null;
      }

      const escapedJson = html.slice(start, nextProduct + 1);

      try {
        return JSON.parse(
          escapedJson.replace(/\\"/g, '"')
        );
      } catch (error) {
        console.error('No se pudo leer el producto:', error);
        return null;
      }
    }


    function renderProductDetail(product) {
      const main = document.querySelector('main');

      if (!main) {
        return;
      }

      document.title = product.title + ' | Venta de Mudanza';

      const price = formatPYG(product.askingPricePYG);

      const dueNow =
        product.saleMode === 'DELAYED'
          ? Math.round(product.askingPricePYG * (product.depositPercent / 100))
          : product.askingPricePYG;

      const balance = product.askingPricePYG - dueNow;

      const statusText =
        product.saleMode === 'DELAYED'
          ? 'RETIRO 9–12 DIC.'
          : 'DISPONIBLE AHORA';

      const gallery = (product.images || [])
        .map((image, index) => {
          return `
        <button
          type="button"
          onclick="document.getElementById('main-product-image').src='/${stripLeadingSlash(image)}'"
          aria-label="Ver foto ${index + 1}"
        >
          <img
            src="/${stripLeadingSlash(image)}"
            alt="${escapeHtml(product.title)}"
          >
        </button>
      `;
        })
        .join('');

      const accessories =
        product.includedAccessories && product.includedAccessories.length
          ? product.includedAccessories.join(' · ')
          : 'Ninguno indicado';

      const logistics =
        product.logisticsNotes && product.logisticsNotes.length
          ? product.logisticsNotes.map(note => `<li>${escapeHtml(note)}</li>`).join('')
          : '<li>Retiro personal.</li>';

      main.innerHTML = `
    <nav class="breadcrumbs" aria-label="Migas de pan">
      <a href="/#articulos">← Volver al catálogo</a>
      <span>/</span>
      <span>${escapeHtml(product.category)}</span>
      <span>/</span>
      <span>${escapeHtml(product.title)}</span>
    </nav>

    <section class="product-page">
      <div class="product-detail">

        <div class="product-gallery">
          <button class="main-image" type="button">
            <img
              id="main-product-image"
              src="/${stripLeadingSlash(product.images[0] || '')}"
              alt="${escapeHtml(product.title)}"
            >
          </button>

          ${product.images.length > 1
          ? `<div class="product-gallery-thumbnails">${gallery}</div>`
          : ''
        }
        </div>

        <div class="product-information">

          <div class="product-meta detail-meta">
            <span>
              ITEM ${String(product.itemNumber).padStart(3, '0')}
              ·
              ${escapeHtml(product.category)}
            </span>

            <span class="${product.saleMode === 'DELAYED'
          ? 'status-later'
          : 'status-now'
        }">
              ${statusText}
            </span>
          </div>

          <h1>${escapeHtml(product.title)}</h1>

          ${product.originalPricePYG
          ? `<del>${formatPYG(product.originalPricePYG)}</del>`
          : ''
        }

          <strong class="detail-price">
            ${price}
            ${product.quantityTotal > 1
          ? ' por unidad'
          : ''
        }
          </strong>

          ${product.quantityTotal > 1
          ? `<p>${product.quantityRemaining} unidades disponibles</p>`
          : ''
        }

          <span class="condition-pill">
            ${escapeHtml(product.condition)}
          </span>

          <p class="lead">
  	    ${escapeHtml(product.description).replace(/\\n/g, '<br>')}
	  </p>

          <div class="payment-breakdown">
            <div>
              <span>Precio total</span>
              <strong>${price}</strong>
            </div>

            <div class="due">
              <span>
                ${product.saleMode === 'DELAYED'
          ? `Reserva hoy (${product.depositPercent}%)`
          : 'A pagar ahora'
        }
              </span>

              <strong>${formatPYG(dueNow)}</strong>
            </div>

            ${balance > 0
          ? `
                  <div>
                    <span>Saldo al retirar</span>
                    <strong>${formatPYG(balance)}</strong>
                  </div>
                `
          : ''
        }

            <div>
              <span>Retiro</span>
              <strong>
                ${product.saleMode === 'DELAYED'
          ? formatPickupWindow(
            product.pickupWindowStart,
            product.pickupWindowEnd
          )
          : 'Disponible después de confirmar el pago'
        }
              </strong>
            </div>
          </div>

          <div class="product-actions">
            <a
              class="secondary-action"
              href="https://wa.me/595972588347?text=${encodeURIComponent(
          'Hola, quisiera consultar sobre ' +
          product.title +
          ' (Item ' +
          String(product.itemNumber).padStart(3, '0') +
          ').'
        )}"
              target="_blank"
              rel="noreferrer"
            >
              Consultar por WhatsApp
            </a>

            <a class="text-action" href="/#articulos">
              ← Volver al catálogo
            </a>
          </div>

          <p class="reservation-rule">
            Un mensaje de interés no reserva el artículo.
            Queda garantizado únicamente después de que confirmemos
            el pago correspondiente.
          </p>

        </div>
      </div>

      <section class="product-notes">

        <div>
          <span class="section-kicker">DETALLES</span>
          <h2>Lo que tenés que saber</h2>
        </div>

        <dl>
          <div>
            <dt>Item ID</dt>
            <dd>Item ${String(product.itemNumber).padStart(3, '0')}</dd>
          </div>

          <div>
            <dt>Estado</dt>
            <dd>${escapeHtml(product.condition)}</dd>
          </div>

          <div>
            <dt>Observaciones</dt>
            <dd>${escapeHtml(product.conditionNotes || 'Sin observaciones adicionales.')}</dd>
          </div>

          <div>
            <dt>Defectos conocidos</dt>
            <dd>${escapeHtml(product.knownDefects || 'Ninguno indicado.')}</dd>
          </div>

          <div>
            <dt>Accesorios incluidos</dt>
            <dd>${escapeHtml(accessories)}</dd>
          </div>

          <div>
            <dt>Disponibilidad</dt>
            <dd>${escapeHtml(statusText)}</dd>
          </div>
        </dl>

        <div class="logistics">
          <strong>Para el retiro</strong>

          <ul>
            ${logistics}
          </ul>

          <p>
            El comprador es responsable del transporte.
            No hacemos delivery ni envíos.
          </p>
        </div>

      </section>
    </section>
  `;
    }


    function formatPYG(value) {
      return 'Gs. ' + Number(value || 0).toLocaleString('es-PY');
    }


    function formatPickupWindow(start, end) {
      if (!start || !end) {
        return 'Fecha a coordinar';
      }

      const startDate = new Date(start + 'T12:00:00');
      const endDate = new Date(end + 'T12:00:00');

      const startDay = startDate.getDate();
      const endDay = endDate.getDate();

      const month = endDate.toLocaleDateString('es-PY', {
        month: 'long'
      });

      return `Ventana del ${startDay}–${endDay} de ${month}`;
    }


    function stripLeadingSlash(value) {
      return String(value || '').replace(/^\/+/, '');
    }


    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  