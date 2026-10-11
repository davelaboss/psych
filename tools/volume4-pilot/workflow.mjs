import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFile = promisify(execFileCallback);

const LABELS = new Map([
  ['name', 'name'], ['nombre', 'name'], ['price', 'price'], ['precio', 'price'],
  ['quantity', 'quantity'], ['cantidad', 'quantity'], ['condition', 'condition'], ['estado', 'condition'],
  ['dimensions', 'dimensions'], ['medidas', 'dimensions'], ['defects', 'defects'], ['defectos', 'defects'],
  ['functionality', 'functionality'], ['funcionamiento', 'functionality'], ['pickup', 'pickup'], ['retiro', 'pickup'],
  ['category', 'category'], ['categoria', 'category'], ['includes', 'includes'], ['incluye', 'includes'],
]);

const UNCERTAIN = /\b(confirm(?:ar|ado)?|pendiente|desconocid[oa]s?|no verificad[oa]s?|revisar)\b|\bfalta\s+(?:confirmar|medir|probar|verificar|informaci[oó]n|datos)\b|\btodav[ií]a\s+no\b|\bprecio\s+estimad[oa]\b/i;
const LEAKAGE = /seg[uú]n (?:confirmaci[oó]n del vendedor|las notas)|el vendedor indic[oó]|confidence|confianza|revisor|reviewer|todo|pendiente de revisi[oó]n/i;

function normalizeKey(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseGroupedNotes(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const groups = [];
  let group = null;
  let section = '';

  for (const raw of lines) {
    const line = raw.trim();
    const groupMatch = line.match(/^GROUP\s+([A-Za-z0-9_-]+)$/i);
    if (groupMatch) {
      if (group) groups.push(group);
      group = { groupId: groupMatch[1], photos: [], notes: [], fields: {} };
      section = '';
      continue;
    }
    if (!group) {
      if (line) throw new Error(`Text before first GROUP: ${line}`);
      continue;
    }
    if (/^Photos:\s*$/i.test(line)) { section = 'photos'; continue; }
    if (/^Notes:\s*$/i.test(line)) { section = 'notes'; continue; }

    const labelMatch = line.match(/^([^:]+):\s*(.*)$/);
    const key = labelMatch ? LABELS.get(normalizeKey(labelMatch[1])) : null;
    if (key) {
      group.fields[key] = labelMatch[2].trim();
      section = '';
      continue;
    }
    if (!line) continue;
    if (section === 'photos') group.photos.push(line);
    else group.notes.push(line);
  }
  if (group) groups.push(group);
  if (!groups.length) throw new Error('No GROUP blocks found.');
  for (const candidate of groups) {
    if (!candidate.photos.length) throw new Error(`GROUP ${candidate.groupId} has no photos.`);
  }
  const ids = groups.map(candidate => candidate.groupId.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new Error('GROUP identifiers must be unique.');
  return groups;
}

function parsePositiveInteger(value, fallback = 0) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  const number = Number(digits || fallback);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function safeText(value, flags, field) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (UNCERTAIN.test(text)) {
    flags.push(`${field}: uncertain and withheld from public copy`);
    return '';
  }
  return text;
}

function safeNoteSentences(notes, flags) {
  return notes.join(' ').split(/(?<=[.!?])\s+/).map(value => value.trim()).filter(Boolean).filter(sentence => {
    if (!UNCERTAIN.test(sentence)) return true;
    flags.push(`notes: uncertain sentence withheld: ${sentence}`);
    return false;
  });
}

export function createDraft(group, itemNumber, publicPhotos) {
  const flags = [];
  const noteSentences = safeNoteSentences(group.notes, flags);
  let title = String(group.fields.name || '').trim();
  if (!title) {
    title = (group.notes.join(' ').split(/[.!?]/)[0] || '').trim();
    flags.push('name: inferred from the first free-form sentence');
  }
  if (!title) throw new Error(`GROUP ${group.groupId} needs a name or descriptive note.`);

  const price = parsePositiveInteger(group.fields.price || group.notes.join(' ').match(/Gs\.?\s*([0-9.]+)/i)?.[1]);
  if (!price) flags.push('price: missing or invalid');
  const quantity = Math.max(1, parsePositiveInteger(group.fields.quantity, 1));
  if (!group.fields.quantity) flags.push('quantity: defaulted to one and needs review');
  const category = String(group.fields.category || 'Otros').trim();
  if (!group.fields.category) flags.push('category: missing; draft uses Otros');

  const condition = safeText(group.fields.condition, flags, 'condition');
  const confirmedDefects = safeText(group.fields.defects, flags, 'defects');
  const defects = confirmedDefects || 'Desgaste por uso normal.';
  const functionality = safeText(group.fields.functionality, flags, 'functionality');
  const dimensions = safeText(group.fields.dimensions, flags, 'dimensions');
  if (!group.fields.condition) flags.push('condition: unknown');
  if (!group.fields.defects) flags.push('defects: unknown');
  if (!group.fields.functionality) flags.push('functionality: unknown');
  if (!group.fields.dimensions) flags.push('dimensions: unknown');

  const descriptionParts = [...noteSentences];
  if (dimensions) descriptionParts.push(`Medidas: ${dimensions.replace(/^Medidas:\s*/i, '')}`);
  if (functionality && !descriptionParts.some(part => part.toLowerCase().includes(functionality.toLowerCase()))) {
    descriptionParts.push(functionality);
  }
  const description = descriptionParts.join(' ').trim() || title;
  const pickup = String(group.fields.pickup || '').toLowerCase();
  const delayed = /delayed|posterior|diciembre|later/.test(pickup);
  if (!pickup) flags.push('pickup: missing; draft defaults to immediate');
  const includedAccessories = String(group.fields.includes || '').split(/[;,]/).map(value => value.trim()).filter(Boolean);
  const slug = `${slugify(title)}-item-${itemNumber}`;

  return {
    product: {
      id: `real-202610-volume4-${itemNumber}`,
      itemNumber,
      slug,
      title,
      category,
      description,
      condition,
      conditionNotes: '',
      knownDefects: defects,
      includedAccessories,
      notIncludedVisible: '',
      photos: publicPhotos,
      asking: price,
      saleMode: delayed ? 'DELAYED' : 'IMMEDIATE',
      pickupDate: delayed ? '2026-12-09' : null,
      pickupWindowStart: delayed ? '2026-12-09' : null,
      pickupWindowEnd: delayed ? '2026-12-12' : null,
      quantityTotal: quantity,
      status: 'NEEDS_REVIEW',
      needsReview: true,
      requiresVehicle: false,
      requiresLoadingHelp: false,
      dateListed: '2026-10-09',
    },
    review: {
      groupId: group.groupId,
      functionality,
      dimensions,
      flags,
    },
  };
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export async function optimizeGroups(groups, { intakeDir, outputDir, publicPrefix = '/images/volume-4-pilot' }) {
  const intakeFiles = (await readdir(intakeDir, { withFileTypes: true })).filter(entry => entry.isFile());
  const intakeByName = new Map(intakeFiles.map(entry => [entry.name.toLowerCase(), entry.name]));
  const referenced = groups.flatMap(group => group.photos.map(photo => ({ group, photo })));
  const normalizedReferences = referenced.map(entry => entry.photo.toLowerCase());
  if (new Set(normalizedReferences).size !== normalizedReferences.length) {
    throw new Error('An original photo is assigned to more than one pilot group.');
  }
  const missing = normalizedReferences.filter(name => !intakeByName.has(name));
  if (missing.length) throw new Error(`Referenced intake photos are missing: ${missing.join(', ')}`);
  const unassigned = intakeFiles.map(entry => entry.name).filter(name => !normalizedReferences.includes(name.toLowerCase()));
  if (unassigned.length) throw new Error(`Intake photos are not assigned to a group: ${unassigned.join(', ')}`);

  await mkdir(outputDir, { recursive: true });
  const report = [];
  const photosByGroup = new Map();
  for (const group of groups) {
    const publicPhotos = [];
    for (let index = 0; index < group.photos.length; index += 1) {
      const originalName = intakeByName.get(group.photos[index].toLowerCase());
      const input = path.join(intakeDir, originalName);
      const outputName = `v4-g${String(group.groupId).padStart(3, '0').toLowerCase()}-${String(index + 1).padStart(2, '0')}.webp`;
      const output = path.join(outputDir, outputName);
      if (await exists(output)) throw new Error(`Refusing to overwrite optimized image: ${outputName}`);

      const originalMetadata = await sharp(input).metadata();
      await sharp(input).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .toColourspace('srgb').webp({ quality: 82 }).toFile(output);
      const optimizedMetadata = await sharp(output).metadata();
      const originalStat = await stat(input);
      const optimizedStat = await stat(output);
      if (optimizedMetadata.width > 2400 || optimizedMetadata.height > 2400) throw new Error(`${outputName} exceeds 2400 px.`);
      if (optimizedMetadata.exif) throw new Error(`${outputName} still contains EXIF metadata.`);
      const publicPath = `${publicPrefix}/${outputName}`;
      publicPhotos.push(publicPath);
      report.push({
        groupId: group.groupId,
        originalFilename: originalName,
        originalWidth: originalMetadata.width,
        originalHeight: originalMetadata.height,
        originalOrientation: originalMetadata.orientation || 1,
        originalBytes: originalStat.size,
        optimizedFilename: outputName,
        optimizedWidth: optimizedMetadata.width,
        optimizedHeight: optimizedMetadata.height,
        optimizedBytes: optimizedStat.size,
        reductionPercent: Number(((1 - optimizedStat.size / originalStat.size) * 100).toFixed(1)),
        publicPath,
        metadataStripped: !optimizedMetadata.exif,
      });
    }
    photosByGroup.set(group.groupId, publicPhotos);
  }
  return { report, photosByGroup };
}

function parseEmbeddedCatalog(html) {
  const marker = '\\"products\\":[';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error('Embedded base catalog not found.');
  const start = markerIndex + marker.length - 1;
  let depth = 0; let end = -1; let inString = false;
  for (let index = start; index < html.length; index += 1) {
    if (html[index] === '\\' && html[index + 1] === '"') { inString = !inString; index += 1; continue; }
    if (inString) continue;
    if (html[index] === '[') depth += 1;
    if (html[index] === ']' && --depth === 0) { end = index; break; }
  }
  if (end < 0) throw new Error('Embedded base catalog is incomplete.');
  return JSON.parse(html.slice(start, end + 1).replace(/\\"/g, '"'));
}

export async function loadExistingProducts(root) {
  const moduleUrl = relative => pathToFileURL(path.join(root, relative)).href;
  const [{ VOLUME2_BATCH_ITEMS }, { SALE_READINESS_SUPPLEMENTAL_ITEMS }, { VOLUME3_ITEMS }, { VOLUME2_IMAGE_MAP }] = await Promise.all([
    import(moduleUrl('source/lib/volume2-batch.ts')),
    import(moduleUrl('source/lib/sale-readiness-supplemental.ts')),
    import(moduleUrl('source/lib/volume3-batch.mjs')),
    import(moduleUrl('source/lib/volume2-image-map.mjs')),
  ]);
  const staticProducts = parseEmbeddedCatalog(await readFile(path.join(root, 'index.html'), 'utf8'));
  const later = [...VOLUME2_BATCH_ITEMS, ...SALE_READINESS_SUPPLEMENTAL_ITEMS, ...VOLUME3_ITEMS].map(item => ({
    ...item,
    slug: item.slug || `${slugify(item.title)}-${item.itemNumber}`,
    images: (item.photos || []).map(name => name.startsWith('/images/') ? name : VOLUME2_IMAGE_MAP[name] || ''),
  }));
  return [...staticProducts, ...later];
}

function duplicates(values) {
  return [...new Map(values.map(value => [String(value), 0])).keys()].filter(value => values.filter(candidate => String(candidate) === value).length > 1);
}

function diskPath(root, publicPath) {
  return path.join(root, String(publicPath).split('?')[0].replace(/^\//, '').replaceAll('/', path.sep));
}

export async function validateCatalog({ root, existingProducts, pilotProducts, intakeReport }) {
  const errors = [];
  const all = [...existingProducts, ...pilotProducts];
  for (const [label, values] of [
    ['item numbers', all.map(item => item.itemNumber)],
    ['product IDs', all.map(item => item.id)],
    ['slugs', all.map(item => item.slug)],
  ]) {
    const found = duplicates(values);
    if (found.length) errors.push(`Duplicate ${label}: ${found.join(', ')}`);
  }

  const validStatuses = new Set(['AVAILABLE', 'SOLD', 'PICKED_UP', 'NEEDS_REVIEW', 'UNLISTED']);
  const validSaleModes = new Set(['IMMEDIATE', 'DELAYED']);
  for (const item of pilotProducts) {
    for (const field of ['id', 'itemNumber', 'slug', 'title', 'category', 'description']) {
      if (item[field] === null || item[field] === undefined || item[field] === '') errors.push(`Item ${item.itemNumber}: missing ${field}.`);
    }
    if (!Number.isInteger(item.itemNumber) || item.itemNumber < 1) errors.push(`Item ${item.itemNumber}: invalid item number.`);
    if (!Number.isInteger(item.asking) || item.asking <= 0) errors.push(`Item ${item.itemNumber}: invalid price.`);
    if (!Number.isInteger(item.quantityTotal) || item.quantityTotal < 1) errors.push(`Item ${item.itemNumber}: invalid quantity.`);
    if (!validStatuses.has(item.status)) errors.push(`Item ${item.itemNumber}: invalid status.`);
    if (!validSaleModes.has(item.saleMode)) errors.push(`Item ${item.itemNumber}: invalid sale mode.`);
    if (!Array.isArray(item.photos) || !item.photos.length) errors.push(`Item ${item.itemNumber}: missing photos.`);
    const duplicatePaths = duplicates(item.photos || []);
    if (duplicatePaths.length) errors.push(`Item ${item.itemNumber}: duplicate photo paths.`);
    for (const value of [item.title, item.description, item.condition, item.knownDefects, ...(item.includedAccessories || [])]) {
      if (LEAKAGE.test(String(value || ''))) errors.push(`Item ${item.itemNumber}: public reviewer/provenance leakage.`);
    }
  }

  const allPilotPhotos = pilotProducts.flatMap(item => item.photos || []);
  const duplicatePilotAssignments = duplicates(allPilotPhotos);
  if (duplicatePilotAssignments.length) errors.push(`Pilot photo assigned more than once: ${duplicatePilotAssignments.join(', ')}`);
  for (const photo of allPilotPhotos) if (!await exists(diskPath(root, photo))) errors.push(`Missing pilot photo file: ${photo}`);
  if (intakeReport.length !== allPilotPhotos.length) errors.push('Image report count does not match pilot photo references.');
  if (errors.length) throw new Error(`Catalog validation failed:\n- ${errors.join('\n- ')}`);
  return { ok: true, existingProductCount: existingProducts.length, pilotProductCount: pilotProducts.length, pilotPhotoCount: allPilotPhotos.length };
}

export async function readSafetyBaseline(root, productionUrl) {
  const [{ stdout: headOut }, { stdout: remoteOut }, response] = await Promise.all([
    execFile('git', ['rev-parse', 'HEAD'], { cwd: root }),
    execFile('git', ['ls-remote', 'origin', 'refs/heads/main'], { cwd: root }),
    fetch(new URL('/.netlify/functions/volume2-catalog', productionUrl), { headers: { accept: 'application/json' } }),
  ]);
  if (!response.ok) throw new Error(`Production catalog check failed with ${response.status}.`);
  const production = await response.json();
  const head = headOut.trim();
  const remoteMain = remoteOut.trim().split(/\s+/)[0];
  if (head !== remoteMain) throw new Error(`Worktree baseline ${head} does not match current remote main ${remoteMain}.`);
  return {
    head,
    remoteMain,
    productionProductCount: production.products.length,
    productionMaxItemNumber: Math.max(...production.products.map(item => Number(item.itemNumber) || 0)),
  };
}

export async function writeBatchModule(file, products) {
  const content = `// Generated by tools/volume4-pilot/run-pilot.mjs.\n// Local review only: every product remains NEEDS_REVIEW and is excluded publicly.\nexport const VOLUME4_ITEMS = Object.freeze(${JSON.stringify(products, null, 2)});\n`;
  await writeFile(file, content, 'utf8');
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function reviewHtml(products, reviews, imageReport) {
  const reviewByGroup = new Map(reviews.map(review => [review.itemNumber, review]));
  const categoryOptions = [
    'Accesorios', 'Accesorios personales', 'Cocina', 'Decoración', 'Electrodomésticos',
    'Electrónica', 'Herramientas', 'Hogar', 'Jardín', 'Juegos', 'Manualidades', 'Muebles',
    'Oficina', 'Otros', 'Salud y cuidado personal',
  ];
  const initialCoverByGroup = new Map([
    ['003', 1],
    ['004', 2],
    ['005', 2],
  ]);
  const reviewItems = products.map(item => {
    const review = reviewByGroup.get(item.itemNumber) || {};
    const localImages = item.photos.map(photo => `../../${photo.replace(/^\//, '')}`);
    return {
      itemNumber: item.itemNumber,
      title: item.title,
      category: item.category,
      price: item.asking,
      description: item.description,
      condition: item.condition,
      defects: item.knownDefects,
      functionality: review.functionality || '',
      dimensions: review.dimensions || '',
      quantity: item.quantityTotal,
      pickupMode: item.saleMode,
      includedAccessories: item.includedAccessories,
      images: localImages,
      coverIndex: initialCoverByGroup.get(review.groupId) || 0,
      flags: review.flags || [],
      categoryOptions,
    };
  });
  const cards = products.map(item => {
    const data = reviewItems.find(reviewItem => reviewItem.itemNumber === item.itemNumber);
    return `<article class="card" data-item="${item.itemNumber}"><img class="cover" src="${data.images[data.coverIndex]}" alt=""><div class="body"><small>ITEM ${String(item.itemNumber).padStart(3, '0')}</small><div class="status-row"><strong class="status-badge status-unreviewed">Sin revisar</strong></div><h2>${escapeHtml(item.title)}</h2><b>Gs. ${item.asking.toLocaleString('es-PY')}</b><p>${escapeHtml(item.description)}</p><div class="card-meta"><span class="missing-indicator"></span><span class="edited-indicator" hidden>✎ Editado</span></div><button type="button" class="review-button">Review details</button></div></article>`;
  }).join('');
  const rows = imageReport.map(row => `<tr><td>${escapeHtml(row.originalFilename)}</td><td>${row.originalWidth}×${row.originalHeight}</td><td>${formatBytes(row.originalBytes)}</td><td>${row.optimizedWidth}×${row.optimizedHeight}</td><td>${formatBytes(row.optimizedBytes)}</td><td>${row.reductionPercent}%</td></tr>`).join('');
  const serializedItems = JSON.stringify(reviewItems).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Volume 4 local review</title><style>
body{font:16px system-ui;margin:0;background:#f4efe7;color:#24201c}header,main{max-width:1180px;margin:auto;padding:24px}.catalog-controls{display:grid;gap:14px;margin-bottom:22px}.search-label{display:grid;gap:6px;max-width:520px;font-weight:700}.search-label input{font:inherit;padding:11px;border:1px solid #9a9188;border-radius:8px;font-weight:400}.filters{display:flex;gap:8px;flex-wrap:wrap}.filters button[aria-pressed="true"]{background:#332e29;color:white}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}.card{background:white;border-radius:16px;overflow:hidden;box-shadow:0 5px 20px #0002}.card[hidden]{display:none}.cover{width:100%;aspect-ratio:4/3;object-fit:contain;background:#eee}.body{padding:18px}.body button,button{padding:10px 14px}.body small,.item-label{color:#8b3e2f;font-weight:700}.status-row{margin:12px 0}.status-badge{display:inline-block;padding:6px 10px;border-radius:999px;font-size:.88rem}.status-unreviewed{background:#e9e5df;color:#403a34}.status-missing{background:#fff0c7;color:#714a00}.status-approved{background:#dcefe2;color:#175b2c}.status-re-review{background:#f5ddf2;color:#722765}.body h2{font-size:1.15rem}.card-meta{min-height:24px;margin:14px 0 10px;display:flex;justify-content:space-between;gap:12px;color:#756b62;font-size:.88rem}.missing-indicator{color:#8a5a00}.edited-indicator{margin-left:auto;color:#6c6259}.dialog-main{display:grid;grid-template-columns:minmax(280px,1.2fr) minmax(300px,1fr);gap:24px}.main-photo{width:100%;max-height:58vh;object-fit:contain;background:#eee}.thumbs{display:flex;gap:8px;overflow:auto;margin:12px 0}.thumbs button{padding:3px;background:white;border:2px solid transparent}.thumbs button.selected{border-color:#8b3e2f}.thumbs img{width:90px;height:70px;object-fit:cover}dialog{width:min(1050px,94vw);max-height:92vh;border:0;border-radius:18px;padding:0}dialog::backdrop{background:#000b}.dialog-shell{padding:20px;position:relative}.dialog-toolbar,.review-actions,.sequence-controls,.edit-actions,.confirm-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dialog-toolbar{justify-content:space-between}.review-actions{margin:10px 0 18px}.review-actions .approve{background:#236b39;color:white}.review-actions .missing{background:#fff0c7}.sequence-controls{justify-content:center;margin-top:18px}.sequence-controls span{min-width:90px;text-align:center}.field-list{display:grid;grid-template-columns:max-content 1fr;gap:8px 16px}.field-list dt{font-weight:700}.field-list dd{margin:0;white-space:pre-wrap;font-weight:400}.internal-review{margin-top:22px;padding:14px;border:2px solid #d6a85f;background:#fff7e8;border-radius:10px}.internal-review h3{margin-top:0}.edit-panel[hidden],.detail-panel[hidden],.unsaved-confirm[hidden]{display:none}.edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.edit-grid label{display:grid;gap:5px;font-weight:700}.edit-grid .wide{grid-column:1/-1}.edit-grid input,.edit-grid textarea,.edit-grid select{font:inherit;padding:8px;font-weight:400}.local-note{font-size:.9rem;color:#6b4c24;background:#fff7e8;padding:10px;border-radius:8px}.unsaved-confirm{position:absolute;inset:0;z-index:3;display:grid;place-content:center;background:#0009;border-radius:18px}.confirm-card{max-width:480px;margin:20px;padding:24px;background:white;border-radius:14px;box-shadow:0 8px 30px #0005}.confirm-card h3{margin-top:0}.report{overflow:auto;margin-top:32px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:9px;border:1px solid #ddd;text-align:left}@media(max-width:760px){.dialog-main{grid-template-columns:1fr}.edit-grid{grid-template-columns:1fr}.edit-grid .wide{grid-column:auto}.field-list{grid-template-columns:1fr}.field-list dd{margin-bottom:8px}}
</style><header><h1>Volume 4 pilot — local review</h1><p>Six existing-product fixtures for workflow review. Nothing here is published; title generation for new products is not validated by this pilot.</p></header><main><section class="catalog-controls"><label class="search-label" for="catalog-search">Search by item number or title<input id="catalog-search" type="search" autocomplete="off" placeholder="Try 250 or blender"></label><div class="filters" role="group" aria-label="Review filters"><button type="button" data-filter="all" data-label="Todos" aria-pressed="true">Todos</button><button type="button" data-filter="unreviewed" data-label="Sin revisar" aria-pressed="false">Sin revisar</button><button type="button" data-filter="missing" data-label="Falta información" aria-pressed="false">Falta información</button><button type="button" data-filter="approved" data-label="Aprobado" aria-pressed="false">Aprobado</button><button type="button" data-filter="re-review" data-label="Revisar de nuevo" aria-pressed="false">Revisar de nuevo</button><button type="button" data-filter="edited" data-label="Editados" aria-pressed="false">Editados</button></div></section><section class="grid">${cards}</section><section class="report"><h2>Image optimization report</h2><table><thead><tr><th>Original</th><th>Original dimensions</th><th>Original size</th><th>Optimized dimensions</th><th>Optimized size</th><th>Reduction</th></tr></thead><tbody>${rows}</tbody></table></section></main>
<dialog id="review-dialog"><div class="dialog-shell"><div class="dialog-toolbar"><button type="button" id="close-review">Close</button><button type="button" id="edit-draft">Edit draft</button></div><div class="detail-panel"><p class="item-label"></p><h2 class="detail-title"></h2><div class="review-actions"><strong class="detail-status status-badge"></strong><button type="button" class="approve" id="approve-draft">Aprobar borrador</button><button type="button" class="missing" id="mark-missing">Falta información</button><button type="button" id="reset-status">Restablecer estado</button></div><div class="dialog-main"><div><img class="main-photo" alt=""><div class="thumbs"></div></div><div><dl class="field-list"></dl><section class="internal-review"><h3>Internal review only</h3><p>These warnings are not customer-facing copy and do not set review status automatically.</p><ul class="flag-list"></ul></section></div></div></div><form class="edit-panel" hidden><h2>Edit local draft</h2><p class="local-note">Saved only in this browser's local storage. This does not update source files, admin, Blob, or production. Editing an approved item changes its status to Revisar de nuevo and requires deliberate re-approval.</p><div class="edit-grid"></div><div class="edit-actions"><button type="submit">Save local edit</button><button type="button" id="cancel-edit">Cancel</button><button type="button" id="reset-edit">Reset draft</button></div></form><div class="sequence-controls"><button type="button" id="previous-item">Anterior</button><span id="position"></span><button type="button" id="next-item">Siguiente</button></div><section class="unsaved-confirm" hidden aria-label="Unsaved changes confirmation"><div class="confirm-card"><h3>You have unsaved changes. Save them before leaving?</h3><div class="confirm-actions"><button type="button" id="confirm-save">Save</button><button type="button" id="confirm-discard">Discard</button><button type="button" id="confirm-cancel">Cancel</button></div></div></section></div></dialog>
<script type="text/plain" id="legacy-review-script">
const baseItems=${serializedItems};const storageKey='psych-volume4-pilot-edits-v1';const statusStorageKey='psych-volume4-pilot-status-v1';const statusLabels={unreviewed:'Sin revisar',missing:'Falta información',approved:'Aprobado'};let localEdits={};let reviewStatuses={};try{localEdits=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}try{reviewStatuses=JSON.parse(localStorage.getItem(statusStorageKey)||'{}')}catch{}let currentIndex=0;let galleryIndex=0;let activeFilter='all';const dialog=document.querySelector('#review-dialog');const detailPanel=dialog.querySelector('.detail-panel');const editPanel=dialog.querySelector('.edit-panel');const searchInput=document.querySelector('#catalog-search');const fields=[['Item number','itemNumber'],['Title','title'],['Category','category'],['Price','price'],['Description','description'],['Condition','condition'],['Defects','defects'],['Functionality','functionality'],['Dimensions','dimensions'],['Quantity','quantity'],['Pickup mode','pickupMode'],['Included accessories','includedAccessories']];
function itemAt(index=currentIndex){const base=baseItems[index];const edit=localEdits[base.itemNumber]||{};return{...base,...edit,includedAccessories:Array.isArray(edit.includedAccessories)?edit.includedAccessories:base.includedAccessories}}
function isEdited(itemNumber){return Object.prototype.hasOwnProperty.call(localEdits,itemNumber)}
function statusOf(itemNumber){return statusLabels[reviewStatuses[itemNumber]]?reviewStatuses[itemNumber]:'unreviewed'}
function text(value,fallback='Unknown / needs review'){if(Array.isArray(value))return value.join('\\n')||'None listed';return value===null||value===undefined||value===''?fallback:String(value)}
function money(value){return 'Gs. '+Number(value||0).toLocaleString('es-PY')}
function persistEdits(){localStorage.setItem(storageKey,JSON.stringify(localEdits))}
function persistStatuses(){localStorage.setItem(statusStorageKey,JSON.stringify(reviewStatuses))}
function setStatus(status){reviewStatuses[baseItems[currentIndex].itemNumber]=status;persistStatuses();renderCards();renderDetail()}
function applyFilters(){const query=searchInput.value.trim().toLocaleLowerCase('es');document.querySelectorAll('.card').forEach((card,index)=>{const item=itemAt(index);const status=statusOf(item.itemNumber);const matchesSearch=!query||String(item.itemNumber).includes(query)||item.title.toLocaleLowerCase('es').includes(query);const matchesFilter=activeFilter==='all'||activeFilter===status||(activeFilter==='edited'&&isEdited(item.itemNumber));card.hidden=!(matchesSearch&&matchesFilter)});const counts={all:baseItems.length,unreviewed:0,missing:0,approved:0,edited:0};baseItems.forEach(item=>{counts[statusOf(item.itemNumber)]+=1;if(isEdited(item.itemNumber))counts.edited+=1});document.querySelectorAll('[data-filter]').forEach(button=>{button.textContent=button.dataset.label+' ('+counts[button.dataset.filter]+')';button.setAttribute('aria-pressed',String(button.dataset.filter===activeFilter))})}
function renderCards(){document.querySelectorAll('.card').forEach((card,index)=>{const item=itemAt(index);const status=statusOf(item.itemNumber);card.querySelector('.cover').src=item.images[item.coverIndex]||item.images[0];card.querySelector('h2').textContent=item.title;card.querySelector('b').textContent=money(item.price);card.querySelector('p').textContent=item.description;const badge=card.querySelector('.status-badge');badge.textContent=statusLabels[status];badge.className='status-badge status-'+status;card.querySelector('.edited-indicator').hidden=!isEdited(item.itemNumber);const missing=card.querySelector('.missing-indicator');missing.textContent=item.flags.length?'⚠ Faltan datos':''});applyFilters()}
function renderDetail(){const item=itemAt();const status=statusOf(item.itemNumber);galleryIndex=Number.isInteger(item.coverIndex)?item.coverIndex:0;dialog.querySelector('.item-label').textContent='ITEM '+String(item.itemNumber).padStart(3,'0')+' · NEEDS REVIEW';dialog.querySelector('.detail-title').textContent=item.title;const statusBadge=dialog.querySelector('.detail-status');statusBadge.textContent=statusLabels[status];statusBadge.className='detail-status status-badge status-'+status;const main=dialog.querySelector('.main-photo');main.src=item.images[galleryIndex]||item.images[0];const thumbs=dialog.querySelector('.thumbs');thumbs.replaceChildren();item.images.forEach((src,index)=>{const button=document.createElement('button');button.type='button';button.className=index===galleryIndex?'selected':'';const image=document.createElement('img');image.src=src;image.alt='Photo '+(index+1);button.append(image);button.onclick=()=>{galleryIndex=index;main.src=src;thumbs.querySelectorAll('button').forEach((node,nodeIndex)=>node.classList.toggle('selected',nodeIndex===index))};thumbs.append(button)});const list=dialog.querySelector('.field-list');list.replaceChildren();fields.forEach(([label,key])=>{const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=key==='price'?money(item[key]):text(item[key]);list.append(dt,dd)});const flags=dialog.querySelector('.flag-list');flags.replaceChildren();(item.flags.length?item.flags:['No internal warnings']).forEach(flag=>{const li=document.createElement('li');li.textContent=flag;flags.append(li)});dialog.querySelector('#position').textContent=(currentIndex+1)+' of '+baseItems.length;detailPanel.hidden=false;editPanel.hidden=true;dialog.querySelector('#edit-draft').hidden=false}
function openReview(index){currentIndex=index;renderDetail();if(!dialog.open)dialog.showModal()}
function move(offset){currentIndex=(currentIndex+offset+baseItems.length)%baseItems.length;renderDetail()}
function input(name,label,value,{type='text',wide=false,options=[],placeholder=''}={}){const wrapper=document.createElement('label');if(wide)wrapper.className='wide';wrapper.append(document.createTextNode(label));let control;if(type==='textarea'){control=document.createElement('textarea');control.rows=3}else if(type==='select'){control=document.createElement('select');options.forEach(option=>{const data=typeof option==='string'?{value:option,label:option}:option;const node=document.createElement('option');node.value=data.value;node.textContent=data.label;control.append(node)});const allowed=Array.from(control.options).map(option=>option.value);if(value&&!allowed.includes(String(value))){control.value='';control.dataset.preserveValue=String(value);control.addEventListener('change',()=>delete control.dataset.preserveValue)}}else{control=document.createElement('input');control.type=type}control.name=name;if(!control.dataset.preserveValue)control.value=value??'';control.placeholder=placeholder;wrapper.append(control);return wrapper}
function showEdit(){const item=itemAt();const categories=item.categoryOptions.includes(item.category)?item.categoryOptions:[item.category,...item.categoryOptions];const grid=dialog.querySelector('.edit-grid');grid.replaceChildren(input('title','Title',item.title),input('category','Category',item.category,{type:'select',options:categories}),input('price','Price',item.price,{type:'number'}),input('quantity','Quantity',item.quantity,{type:'number'}),input('description','Description',item.description,{type:'textarea',wide:true}),input('condition','Condition',item.condition,{type:'select',options:[{value:'',label:'—'},{value:'Estado regular',label:'Estado regular'},{value:'Buen estado',label:'Buen estado'},{value:'Muy buen estado',label:'Muy buen estado'}]}),input('functionality','Functionality',item.functionality,{type:'select',options:[{value:'',label:'— / No aplica'},{value:'Funciona bien',label:'Funciona bien'},{value:'Funciona muy bien',label:'Funciona muy bien'}]}),input('defects','Defects',item.defects,{type:'textarea',wide:true}),input('dimensions','Dimensions',item.dimensions,{wide:true,placeholder:'Ej.: 80 × 45 × 90 cm (alto × ancho × profundidad)'}),input('pickupMode','Pickup mode',item.pickupMode,{type:'select',options:['IMMEDIATE','DELAYED']}),input('includedAccessories','Included accessories (one per line)',item.includedAccessories.join('\\n'),{type:'textarea',wide:true}),input('coverIndex','Main photo',item.coverIndex,{type:'select',options:item.images.map((_,index)=>({value:String(index),label:'Photo '+(index+1)}))}));detailPanel.hidden=true;editPanel.hidden=false;dialog.querySelector('#edit-draft').hidden=true}
document.querySelectorAll('.review-button').forEach((button,index)=>button.onclick=()=>openReview(index));document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{activeFilter=button.dataset.filter;applyFilters()});searchInput.addEventListener('input',applyFilters);dialog.querySelector('#close-review').onclick=()=>dialog.close();dialog.querySelector('#previous-item').onclick=()=>move(-1);dialog.querySelector('#next-item').onclick=()=>move(1);dialog.querySelector('#edit-draft').onclick=showEdit;dialog.querySelector('#approve-draft').onclick=()=>setStatus('approved');dialog.querySelector('#mark-missing').onclick=()=>setStatus('missing');dialog.querySelector('#reset-status').onclick=()=>setStatus('unreviewed');dialog.querySelector('#cancel-edit').onclick=renderDetail;dialog.querySelector('#reset-edit').onclick=()=>{delete localEdits[baseItems[currentIndex].itemNumber];persistEdits();renderCards();renderDetail()};editPanel.onsubmit=event=>{event.preventDefault();const itemNumber=baseItems[currentIndex].itemNumber;const data=new FormData(editPanel);const selected=name=>{const control=editPanel.elements.namedItem(name);return control.dataset.preserveValue??String(data.get(name)||'')};localEdits[itemNumber]={title:data.get('title').trim(),category:data.get('category').trim(),price:Number(data.get('price')),description:data.get('description').trim(),condition:selected('condition').trim(),defects:data.get('defects').trim(),functionality:selected('functionality').trim(),dimensions:data.get('dimensions').trim(),quantity:Number(data.get('quantity')),pickupMode:data.get('pickupMode'),includedAccessories:data.get('includedAccessories').split(/\\r?\\n/).map(value=>value.trim()).filter(Boolean),coverIndex:Number(data.get('coverIndex'))};persistEdits();if(statusOf(itemNumber)==='approved'){reviewStatuses[itemNumber]='unreviewed';persistStatuses()}renderCards();renderDetail()};document.addEventListener('keydown',event=>{if(!dialog.open||!editPanel.hidden)return;if(event.key==='ArrowLeft'){event.preventDefault();move(-1)}if(event.key==='ArrowRight'){event.preventDefault();move(1)}});renderCards();
</script><script>
const baseItems=${serializedItems};
const storageKey='psych-volume4-pilot-edits-v1',statusStorageKey='psych-volume4-pilot-status-v1';
const statusLabels={unreviewed:'Sin revisar',missing:'Falta información',approved:'Aprobado','re-review':'Revisar de nuevo'};
let localEdits={},reviewStatuses={},currentIndex=0,galleryIndex=0,activeFilter='all';
try{localEdits=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}
try{reviewStatuses=JSON.parse(localStorage.getItem(statusStorageKey)||'{}')}catch{}
const dialog=document.querySelector('#review-dialog'),detailPanel=dialog.querySelector('.detail-panel'),editPanel=dialog.querySelector('.edit-panel'),unsavedConfirm=dialog.querySelector('.unsaved-confirm'),searchInput=document.querySelector('#catalog-search'),previousButton=dialog.querySelector('#previous-item'),nextButton=dialog.querySelector('#next-item');
const fields=[['Item number','itemNumber'],['Title','title'],['Category','category'],['Price','price'],['Description','description'],['Condition','condition'],['Defects','defects'],['Functionality','functionality'],['Dimensions','dimensions'],['Quantity','quantity'],['Pickup mode','pickupMode'],['Included accessories','includedAccessories']];
function itemAt(index=currentIndex){const base=baseItems[index],edit=localEdits[base.itemNumber]||{};return{...base,...edit,includedAccessories:Array.isArray(edit.includedAccessories)?edit.includedAccessories:base.includedAccessories}}
function isEdited(itemNumber){return Object.prototype.hasOwnProperty.call(localEdits,itemNumber)}
function statusOf(itemNumber){return statusLabels[reviewStatuses[itemNumber]]?reviewStatuses[itemNumber]:'unreviewed'}
function text(value,fallback='Unknown / needs review'){if(Array.isArray(value))return value.join('\\n')||'None listed';return value===null||value===undefined||value===''?fallback:String(value)}
function money(value){return 'Gs. '+Number(value||0).toLocaleString('es-PY')}
function persistEdits(){localStorage.setItem(storageKey,JSON.stringify(localEdits))}
function persistStatuses(){localStorage.setItem(statusStorageKey,JSON.stringify(reviewStatuses))}
function setStatus(status){reviewStatuses[baseItems[currentIndex].itemNumber]=status;persistStatuses();renderCards();renderDetail()}
function applyFilters(){const query=searchInput.value.trim().toLocaleLowerCase('es');document.querySelectorAll('.card').forEach((card,index)=>{const item=itemAt(index),status=statusOf(item.itemNumber);const matchesSearch=!query||String(item.itemNumber).includes(query)||item.title.toLocaleLowerCase('es').includes(query);const matchesFilter=activeFilter==='all'||activeFilter===status||(activeFilter==='edited'&&isEdited(item.itemNumber));card.hidden=!(matchesSearch&&matchesFilter)});const counts={all:baseItems.length,unreviewed:0,missing:0,approved:0,'re-review':0,edited:0};baseItems.forEach(item=>{counts[statusOf(item.itemNumber)]+=1;if(isEdited(item.itemNumber))counts.edited+=1});document.querySelectorAll('[data-filter]').forEach(button=>{button.textContent=button.dataset.label+' ('+counts[button.dataset.filter]+')';button.setAttribute('aria-pressed',String(button.dataset.filter===activeFilter))})}
function renderCards(){document.querySelectorAll('.card').forEach((card,index)=>{const item=itemAt(index),status=statusOf(item.itemNumber);card.querySelector('.cover').src=item.images[item.coverIndex]||item.images[0];card.querySelector('h2').textContent=item.title;card.querySelector('b').textContent=money(item.price);card.querySelector('p').textContent=item.description;const badge=card.querySelector('.status-badge');badge.textContent=statusLabels[status];badge.className='status-badge status-'+status;card.querySelector('.edited-indicator').hidden=!isEdited(item.itemNumber);card.querySelector('.missing-indicator').textContent=item.flags.length?'⚠ Faltan datos':''});applyFilters()}
function updateNavigationLabels(){const dirty=isDirty();previousButton.textContent=dirty?'Guardar y anterior':'Anterior';nextButton.textContent=dirty?'Guardar y siguiente':'Siguiente'}
function renderDetail(){const item=itemAt(),status=statusOf(item.itemNumber);galleryIndex=Number.isInteger(item.coverIndex)?item.coverIndex:0;unsavedConfirm.hidden=true;dialog.querySelector('.item-label').textContent='ITEM '+String(item.itemNumber).padStart(3,'0')+' · NEEDS REVIEW';dialog.querySelector('.detail-title').textContent=item.title;const statusBadge=dialog.querySelector('.detail-status');statusBadge.textContent=statusLabels[status];statusBadge.className='detail-status status-badge status-'+status;const main=dialog.querySelector('.main-photo');main.src=item.images[galleryIndex]||item.images[0];const thumbs=dialog.querySelector('.thumbs');thumbs.replaceChildren();item.images.forEach((src,index)=>{const button=document.createElement('button');button.type='button';button.className=index===galleryIndex?'selected':'';const image=document.createElement('img');image.src=src;image.alt='Photo '+(index+1);button.append(image);button.onclick=()=>{galleryIndex=index;main.src=src;thumbs.querySelectorAll('button').forEach((node,nodeIndex)=>node.classList.toggle('selected',nodeIndex===index))};thumbs.append(button)});const list=dialog.querySelector('.field-list');list.replaceChildren();fields.forEach(([label,key])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=key==='price'?money(item[key]):text(item[key]);list.append(dt,dd)});const flags=dialog.querySelector('.flag-list');flags.replaceChildren();(item.flags.length?item.flags:['No internal warnings']).forEach(flag=>{const li=document.createElement('li');li.textContent=flag;flags.append(li)});dialog.querySelector('#position').textContent=(currentIndex+1)+' of '+baseItems.length;detailPanel.hidden=false;editPanel.hidden=true;dialog.querySelector('#edit-draft').hidden=false;updateNavigationLabels()}
function openReview(index){currentIndex=index;renderDetail();if(!dialog.open)dialog.showModal()}
function move(offset){currentIndex=(currentIndex+offset+baseItems.length)%baseItems.length;renderDetail()}
function input(name,label,value,{type='text',wide=false,options=[],placeholder=''}={}){const wrapper=document.createElement('label');if(wide)wrapper.className='wide';wrapper.append(document.createTextNode(label));let control;if(type==='textarea'){control=document.createElement('textarea');control.rows=3}else if(type==='select'){control=document.createElement('select');options.forEach(option=>{const data=typeof option==='string'?{value:option,label:option}:option,node=document.createElement('option');node.value=data.value;node.textContent=data.label;control.append(node)});const allowed=Array.from(control.options).map(option=>option.value);if(value&&!allowed.includes(String(value))){control.value='';control.dataset.preserveValue=String(value);control.addEventListener('change',()=>delete control.dataset.preserveValue)}}else{control=document.createElement('input');control.type=type}control.name=name;if(!control.dataset.preserveValue)control.value=value??'';control.placeholder=placeholder;wrapper.append(control);return wrapper}
function selectedValue(name,data){const control=editPanel.elements.namedItem(name);return control.dataset.preserveValue??String(data.get(name)||'')}
function formDraft(){const data=new FormData(editPanel);return{title:data.get('title').trim(),category:data.get('category').trim(),price:Number(data.get('price')),description:data.get('description').trim(),condition:selectedValue('condition',data).trim(),defects:data.get('defects').trim(),functionality:selectedValue('functionality',data).trim(),dimensions:data.get('dimensions').trim(),quantity:Number(data.get('quantity')),pickupMode:data.get('pickupMode'),includedAccessories:data.get('includedAccessories').split(/\\r?\\n/).map(value=>value.trim()).filter(Boolean),coverIndex:Number(data.get('coverIndex'))}}
function editableDraft(item){return{title:item.title,category:item.category,price:Number(item.price),description:item.description,condition:item.condition,defects:item.defects,functionality:item.functionality,dimensions:item.dimensions,quantity:Number(item.quantity),pickupMode:item.pickupMode,includedAccessories:[...item.includedAccessories],coverIndex:Number(item.coverIndex)}}
function savedDraft(){return editableDraft(itemAt())}
function isDirty(){return !editPanel.hidden&&JSON.stringify(formDraft())!==JSON.stringify(savedDraft())}
function showEdit(){const item=itemAt(),categories=item.categoryOptions.includes(item.category)?item.categoryOptions:[item.category,...item.categoryOptions],grid=dialog.querySelector('.edit-grid');grid.replaceChildren(input('title','Title',item.title),input('category','Category',item.category,{type:'select',options:categories}),input('price','Price',item.price,{type:'number'}),input('quantity','Quantity',item.quantity,{type:'number'}),input('description','Description',item.description,{type:'textarea',wide:true}),input('condition','Condition',item.condition,{type:'select',options:[{value:'',label:'—'},{value:'Estado regular',label:'Estado regular'},{value:'Buen estado',label:'Buen estado'},{value:'Muy buen estado',label:'Muy buen estado'}]}),input('functionality','Functionality',item.functionality,{type:'select',options:[{value:'',label:'— / No aplica'},{value:'Funciona bien',label:'Funciona bien'},{value:'Funciona muy bien',label:'Funciona muy bien'}]}),input('defects','Defects',item.defects,{type:'textarea',wide:true}),input('dimensions','Dimensions',item.dimensions,{wide:true,placeholder:'Ej.: 80 × 45 × 90 cm (alto × ancho × profundidad)'}),input('pickupMode','Pickup mode',item.pickupMode,{type:'select',options:['IMMEDIATE','DELAYED']}),input('includedAccessories','Included accessories (one per line)',item.includedAccessories.join('\\n'),{type:'textarea',wide:true}),input('coverIndex','Main photo',item.coverIndex,{type:'select',options:item.images.map((_,index)=>({value:String(index),label:'Photo '+(index+1)}))}));detailPanel.hidden=true;editPanel.hidden=false;dialog.querySelector('#edit-draft').hidden=true;editPanel.querySelectorAll('input,textarea,select').forEach(control=>{control.addEventListener('input',updateNavigationLabels);control.addEventListener('change',updateNavigationLabels)});updateNavigationLabels()}
function saveCurrentEdit(){if(!isDirty()){renderDetail();return false}const itemNumber=baseItems[currentIndex].itemNumber;localEdits[itemNumber]=formDraft();persistEdits();if(statusOf(itemNumber)==='approved'){reviewStatuses[itemNumber]='re-review';persistStatuses()}renderCards();renderDetail();return true}
function navigate(offset){if(!editPanel.hidden&&isDirty())saveCurrentEdit();move(offset)}
function showUnsavedConfirmation(){unsavedConfirm.hidden=false;dialog.querySelector('#confirm-save').focus()}
function leaveEditViaEscape(){if(isDirty())showUnsavedConfirmation();else renderDetail()}
document.querySelectorAll('.review-button').forEach((button,index)=>button.onclick=()=>openReview(index));
document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{activeFilter=button.dataset.filter;applyFilters()});
searchInput.addEventListener('input',applyFilters);
dialog.querySelector('#close-review').onclick=()=>{if(!editPanel.hidden)leaveEditViaEscape();else dialog.close()};
previousButton.onclick=()=>navigate(-1);nextButton.onclick=()=>navigate(1);
dialog.querySelector('#edit-draft').onclick=showEdit;
dialog.querySelector('#approve-draft').onclick=()=>setStatus('approved');
dialog.querySelector('#mark-missing').onclick=()=>setStatus('missing');
dialog.querySelector('#reset-status').onclick=()=>setStatus('unreviewed');
dialog.querySelector('#cancel-edit').onclick=renderDetail;
dialog.querySelector('#reset-edit').onclick=()=>{delete localEdits[baseItems[currentIndex].itemNumber];persistEdits();renderCards();renderDetail()};
editPanel.onsubmit=event=>{event.preventDefault();saveCurrentEdit()};
dialog.querySelector('#confirm-save').onclick=()=>{unsavedConfirm.hidden=true;saveCurrentEdit()};
dialog.querySelector('#confirm-discard').onclick=()=>{unsavedConfirm.hidden=true;renderDetail()};
dialog.querySelector('#confirm-cancel').onclick=()=>{unsavedConfirm.hidden=true;updateNavigationLabels()};
dialog.addEventListener('cancel',event=>event.preventDefault());
document.addEventListener('keydown',event=>{if(!dialog.open)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!unsavedConfirm.hidden){unsavedConfirm.hidden=true;updateNavigationLabels();return}if(!editPanel.hidden){leaveEditViaEscape();return}dialog.close();return}if(!unsavedConfirm.hidden)return;if(event.key==='ArrowLeft'){event.preventDefault();navigate(-1)}if(event.key==='ArrowRight'){event.preventDefault();navigate(1)}},true);
renderCards();
</script></html>`
    .replace('Volume 4 pilot — local review', 'Volume 4 — local review')
    .replace('Six existing-product fixtures for workflow review. Nothing here is published; title generation for new products is not validated by this pilot.', 'Local draft products for owner review. Nothing here is published automatically.');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export async function writeReports(reportDir, payload) {
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, 'pilot-report.json'), JSON.stringify(payload, null, 2), 'utf8');
  await writeFile(path.join(reportDir, 'review.html'), reviewHtml(payload.products, payload.reviews, payload.images), 'utf8');
}
