const SLOT_DEFINITIONS = Object.freeze({
  MONDAY_AM: {
    label: 'Monday AM',
    hook: 'Arrancamos la semana con opciones prácticas para la casa.',
  },
  MONDAY_PM: {
    label: 'Monday PM',
    hook: 'Para cerrar el lunes, mirá estos artículos que siguen disponibles.',
  },
  TUESDAY_AM: {
    label: 'Tuesday AM',
    hook: 'Este martes compartimos una selección variada de la venta de mudanza.',
  },
  TUESDAY_PM: {
    label: 'Tuesday PM',
    hook: 'Todavía hay buenas opciones para aprovechar este martes.',
  },
  WEDNESDAY_AM: {
    label: 'Wednesday AM',
    hook: 'Mitad de semana: una selección de artículos útiles que podés ver hoy.',
  },
  WEDNESDAY_PM: {
    label: 'Wednesday PM',
    hook: 'Antes de terminar el miércoles, te mostramos esta selección.',
  },
  THURSDAY_AM: {
    label: 'Thursday AM',
    hook: 'El jueves empieza con más artículos de nuestra venta de mudanza.',
  },
  THURSDAY_PM: {
    label: 'Thursday PM',
    hook: 'Esta tarde destacamos opciones para distintos espacios y presupuestos.',
  },
  FRIDAY_AM: {
    label: 'Friday AM',
    hook: 'Llegó el viernes con artículos que todavía están disponibles.',
  },
  FRIDAY_PM: {
    label: 'Friday PM',
    hook: 'Cerramos la semana con una selección fresca de la venta de mudanza.',
  },
});

export const MARKETING_SLOT_KEYS = Object.freeze(
  Object.keys(SLOT_DEFINITIONS)
);

const RECENT_DAYS = 14;
const MAX_PRODUCTS = 3;
const MIN_PRODUCTS = 2;

function normalizedStatus(product) {
  return String(product?.status || '').trim().toUpperCase();
}

function hasPublicImage(product) {
  return Array.isArray(product?.images) && product.images.some(Boolean);
}

export function isMarketingEligible(product) {
  if (!product || normalizedStatus(product) !== 'AVAILABLE') return false;
  if (Boolean(product.needsReview)) return false;
  if (Boolean(product.hidden) || Boolean(product.isHidden)) return false;
  if (product.visible === false || product.public === false || product.published === false) return false;
  if (product.marketingInventoryVerified === false) return false;
  if (Boolean(product.isDemo)) return false;
  if (product.purchasableQuantity !== undefined && Number(product.purchasableQuantity) < 1) return false;
  if (Number(product.quantityRemaining ?? 0) < 1) return false;
  if (!String(product.slug || '').trim()) return false;
  if (!String(product.title || '').trim()) return false;
  if (Number(product.askingPricePYG || 0) <= 0) return false;
  if (!hasPublicImage(product)) return false;
  return true;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededFraction(seed, productId) {
  return hashSeed(`${seed}:${productId}`) / 0xffffffff;
}

function normalizedCategory(product) {
  return String(product.category || 'Otros').trim().toLocaleLowerCase('es');
}

function priceBand(product) {
  const price = Number(product.askingPricePYG || 0);
  if (price < 75000) return 'LOW';
  if (price < 300000) return 'MID';
  return 'HIGH';
}

function bulky(product) {
  return Boolean(product.requiresVehicle || product.requiresLoadingHelp) ||
    /mueble|electrodom[eé]stico/i.test(String(product.category || ''));
}

function visuallyStrong(product) {
  const category = normalizedCategory(product);
  return Boolean(product.featured) || (product.images || []).length > 1 ||
    /decoraci[oó]n|cocina|electr[oó]nica|jard[ií]n|accesorios/i.test(category);
}

function featureAgeDays(entry, slotDate) {
  const featured = Date.parse(entry.featuredAt || `${entry.slotDate}T12:00:00Z`);
  const current = Date.parse(`${slotDate}T12:00:00Z`);
  if (!Number.isFinite(featured) || !Number.isFinite(current)) return Infinity;
  return Math.max(0, (current - featured) / 86400000);
}

function newestHistoryByProduct(history, slotDate) {
  const result = new Map();
  for (const entry of history || []) {
    const productId = String(entry.productId || '');
    if (!productId) continue;
    const age = featureAgeDays(entry, slotDate);
    const current = result.get(productId);
    if (!current || age < current.age) result.set(productId, { ...entry, age });
  }
  return result;
}

function rankCandidate(product, selected, recentByProduct, seed) {
  const previous = recentByProduct.get(product.id);
  const categories = new Set(selected.map(normalizedCategory));
  const priceBands = new Set(selected.map(priceBand));
  let score = seededFraction(seed, product.id) * 12;

  score += Math.min(3, (product.images || []).length) * 7;
  if (visuallyStrong(product) && !selected.some(visuallyStrong)) score += 34;
  if (!categories.has(normalizedCategory(product))) score += 28;
  if (!priceBands.has(priceBand(product))) score += 20;
  if (bulky(product)) score -= selected.some(bulky) ? 16 : 4;
  if (previous?.age <= 30) score -= 70 - Math.min(30, previous.age);

  return score;
}

export function selectMarketingProducts({
  products,
  history = [],
  slotDate,
  slotKey,
  seed = `${slotDate}:${slotKey}`,
}) {
  if (!SLOT_DEFINITIONS[slotKey]) throw new Error('Franja de marketing inválida.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(slotDate || ''))) throw new Error('Fecha de marketing inválida.');

  const eligible = (products || []).filter(isMarketingEligible);
  if (eligible.length < MIN_PRODUCTS) {
    throw new Error('No hay por lo menos dos artículos públicos disponibles para preparar el correo.');
  }

  const recentByProduct = newestHistoryByProduct(history, slotDate);
  const sameDayIds = new Set(
    (history || [])
      .filter((entry) => entry.slotDate === slotDate && entry.slotKey !== slotKey)
      .map((entry) => entry.productId)
  );
  const fresh = eligible.filter((product) => {
    const previous = recentByProduct.get(product.id);
    return !sameDayIds.has(product.id) && (!previous || previous.age > RECENT_DAYS);
  });
  const pool = fresh.length >= MIN_PRODUCTS ? fresh : eligible;
  const selected = [];

  while (selected.length < MAX_PRODUCTS) {
    const remaining = pool
      .filter((product) => !selected.some((item) => item.id === product.id))
      .filter((product) => !(bulky(product) && selected.filter(bulky).length >= 2))
      .sort((left, right) =>
        rankCandidate(right, selected, recentByProduct, seed) -
        rankCandidate(left, selected, recentByProduct, seed)
      );
    if (!remaining.length) break;
    selected.push(remaining[0]);
  }

  if (selected.length < MIN_PRODUCTS) {
    const fallback = eligible
      .filter((product) => !selected.some((item) => item.id === product.id))
      .sort((left, right) =>
        rankCandidate(right, selected, recentByProduct, seed) -
        rankCandidate(left, selected, recentByProduct, seed)
      );
    while (selected.length < MIN_PRODUCTS && fallback.length) selected.push(fallback.shift());
  }

  return selected;
}

export function marketingSlot(slotKey) {
  const slot = SLOT_DEFINITIONS[slotKey];
  if (!slot) throw new Error('Franja de marketing inválida.');
  return { key: slotKey, ...slot };
}

export function formatGuaranies(value) {
  return `${new Intl.NumberFormat('es-PY').format(Number(value || 0))} Gs.`;
}

export function marketingProductLink(product, origin) {
  return new URL(`/producto/${encodeURIComponent(product.slug)}`, origin).toString();
}

export function marketingImageUrl(product, origin) {
  return new URL(String(product.images[0]), origin).toString();
}

function itemLabel(product) {
  return `Item ${String(product.itemNumber).padStart(3, '0')}`;
}

export function buildSocialCopy({ slotKey, products, origin }) {
  const slot = marketingSlot(slotKey);
  const lines = [
    '🏠 VENTA DE MUDANZA',
    '',
    slot.hook,
    '',
    ...products.flatMap((product) => [
      `• ${itemLabel(product)} — ${String(product.title).trim()}`,
      `  ${formatGuaranies(product.askingPricePYG)}`,
      `  ${marketingProductLink(product, origin)}`,
      '',
    ]),
    'La disponibilidad puede cambiar a medida que se confirman las compras.',
    'Retiro personal en San Lorenzo, Barrio Santo Tomás. Sin delivery ni envíos.',
  ];
  return lines.join('\n').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function copyHtml(copy) {
  return escapeHtml(copy).replaceAll('\n', '<br>');
}

export function buildMarketingEmail({ slotKey, products, origin }) {
  const slot = marketingSlot(slotKey);
  const subject = `Venta de mudanza | ${slot.label}`;
  const socialCopy = buildSocialCopy({ slotKey, products, origin });
  const photoCards = products.map((product) => `
    <article style="margin:0 0 22px;border:1px solid #ded8cd;border-radius:14px;overflow:hidden;background:#fff;">
      <img src="${escapeHtml(marketingImageUrl(product, origin))}" alt="${escapeHtml(`${itemLabel(product)} — ${product.title}`)}" style="display:block;width:100%;height:auto;max-height:460px;object-fit:contain;background:#f5f1ea;">
      <div style="padding:14px 16px;">
        <strong style="display:block;font-size:17px;line-height:1.35;">${escapeHtml(itemLabel(product))} — ${escapeHtml(product.title)}</strong>
        <span style="display:block;margin-top:5px;color:#5b554d;">${escapeHtml(formatGuaranies(product.askingPricePYG))}</span>
      </div>
    </article>`).join('');
  const links = products.map((product) => `
    <li style="margin:0 0 12px;">
      <a href="${escapeHtml(marketingProductLink(product, origin))}" style="color:#145c45;font-weight:700;">${escapeHtml(itemLabel(product))} — ${escapeHtml(product.title)}</a>
    </li>`).join('');
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#eee9df;color:#26231f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <main style="box-sizing:border-box;width:100%;max-width:620px;margin:0 auto;padding:20px 14px 38px;">
    <header style="padding:22px 20px;border-radius:16px 16px 0 0;background:#173f35;color:#fff;">
      <div style="font-size:12px;letter-spacing:.12em;font-weight:800;">VENTA DE MUDANZA</div>
      <h1 style="margin:8px 0 0;font-size:27px;line-height:1.2;">Publicación ${escapeHtml(slot.label)}</h1>
    </header>
    <section style="padding:22px 20px;background:#fff;">
      <h2 style="margin:0 0 12px;font-size:17px;letter-spacing:.04em;">1. LISTO PARA COPIAR Y PEGAR</h2>
      <div style="padding:16px;border-radius:12px;background:#f7f3ec;font-size:16px;line-height:1.55;word-break:break-word;">${copyHtml(socialCopy)}</div>
    </section>
    <section style="padding:22px 20px;background:#faf8f4;">
      <h2 style="margin:0 0 14px;font-size:17px;letter-spacing:.04em;">2. FOTOS PARA PUBLICAR</h2>
      <p style="margin:0 0 16px;color:#5b554d;line-height:1.45;">Las mismas fotos están adjuntas como archivos JPEG para guardarlas o compartirlas desde el iPhone.</p>
      ${photoCards}
    </section>
    <section style="padding:22px 20px;background:#fff;border-radius:0 0 16px 16px;">
      <h2 style="margin:0 0 14px;font-size:17px;letter-spacing:.04em;">3. ENLACES DIRECTOS</h2>
      <ul style="margin:0;padding-left:20px;line-height:1.45;">${links}</ul>
    </section>
  </main>
</body></html>`;
  const text = [
    '1. LISTO PARA COPIAR Y PEGAR',
    socialCopy,
    '',
    '2. FOTOS PARA PUBLICAR',
    ...products.map((product) => `${itemLabel(product)} — ${product.title} (foto adjunta: ${itemLabel(product).replace(' ', '-')}.jpg)`),
    '',
    '3. ENLACES DIRECTOS',
    ...products.map((product) => `${itemLabel(product)} — ${marketingProductLink(product, origin)}`),
  ].join('\n');

  return { subject, socialCopy, html, text };
}

export function jpegTransformUrl(product, origin) {
  const source = new URL(String(product.images[0]), origin);
  const transform = new URL('/.netlify/images', origin);
  transform.searchParams.set('url', `${source.pathname}${source.search}`);
  transform.searchParams.set('w', '1600');
  transform.searchParams.set('q', '84');
  transform.searchParams.set('fm', 'jpg');
  return transform.toString();
}

export async function buildImageAttachments(products, origin, fetchImpl = fetch) {
  const attachments = [];
  for (const product of products) {
    const response = await fetchImpl(jpegTransformUrl(product, origin), {
      headers: { accept: 'image/jpeg' },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`No se pudo preparar la foto del ${itemLabel(product)}.`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/jpeg')) throw new Error(`La foto del ${itemLabel(product)} no se pudo convertir a JPEG.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error(`La foto del ${itemLabel(product)} está vacía.`);
    attachments.push({
      filename: `${itemLabel(product).replace(' ', '-')}.jpg`,
      content: Buffer.from(bytes).toString('base64'),
      content_type: 'image/jpeg',
    });
  }
  return attachments;
}

export function packetForClient(packet) {
  return {
    id: packet.id,
    slotDate: packet.slotDate,
    slotKey: packet.slotKey,
    slotLabel: marketingSlot(packet.slotKey).label,
    subject: packet.subject,
    socialCopy: packet.socialCopy,
    status: packet.status,
    sentAt: packet.sentAt || null,
    products: packet.products,
  };
}
