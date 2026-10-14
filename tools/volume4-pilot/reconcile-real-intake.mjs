import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import {
  loadExistingProducts, slugify, validateCatalog, writeBatchModule, writeReports,
} from './workflow.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const workbookPath = 'C:/Users/davel/Downloads/Vol 4/notes measurements for pics vol 6^J7.xlsx';
const intakeDir = 'C:/Users/davel/Downloads/Vol 4/originals';
const reportDir = path.join(root, 'volume4/review-output');
const reportPath = path.join(reportDir, 'real-intake-report.json');
const batchPath = path.join(root, 'source/lib/volume4-batch.mjs');
const imageDir = path.join(root, 'images/volume-4');

const payload = JSON.parse(await readFile(reportPath, 'utf8'));
const workbookBefore = await stat(workbookPath);
const pythonCandidates = [
  process.env.CODEX_PYTHON,
  'C:/Users/davel/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
  'python',
].filter(Boolean);
let workbookData;
for (const python of pythonCandidates) {
  try {
    workbookData = JSON.parse(execFileSync(python, [path.join(root, 'tools/volume4-pilot/read-volume4-workbook.py'), workbookPath], { encoding: 'utf8' }));
    break;
  } catch (error) {
    if (python === pythonCandidates.at(-1)) throw error;
  }
}

const products = payload.products.map(product => ({ ...product, includedAccessories: [...product.includedAccessories], photos: [...product.photos] }));
const reviews = payload.reviews.map(review => ({ ...review, flags: [...review.flags], sourcePhotos: [...review.sourcePhotos], referenceImages: [...review.referenceImages] }));
const productByItem = new Map(products.map(product => [product.itemNumber, product]));
const reviewByItem = new Map(reviews.map(review => [review.itemNumber, review]));

function photoNumber(filename) {
  return Number(String(filename).match(/(\d{3})(?=\.[^.]+$)/)?.[1]);
}

function findItemForRow(row) {
  if (!row.photoReferences.length) return null;
  const matches = reviews.filter(review => review.sourcePhotos.some(filename => row.photoReferences.includes(photoNumber(filename))));
  if (matches.length !== 1) throw new Error(`Spreadsheet row ${row.rowNumber} matched ${matches.length} items.`);
  return matches[0].itemNumber;
}

function parsedCondition(raw) {
  const value = String(raw || '').match(/(?:^|\n)\s*C:\s*([^\n]*)/i)?.[1]?.trim().toLowerCase() || '';
  if (value === 'good') return 'Buen estado';
  if (value === 'fair' || value.includes('esteitic fair')) return 'Estado regular';
  if (value === 'very good') return 'Muy buen estado';
  return '';
}

function rawField(raw, prefix) {
  return String(raw || '').match(new RegExp(`(?:^|\\n)\\s*${prefix}:\\s*([^\\n]*)`, 'i'))?.[1]?.trim() || '';
}

function specificDefect(raw) {
  const value = rawField(raw, 'D');
  if (!value || /^(n|no|na|n\/a)$/i.test(value)) return '';
  const normalized = value.toLowerCase();
  if (normalized.includes('sin soportes')) return 'No incluye soportes. Desgaste por uso normal.';
  if (normalized.includes('missing borlitas')) return 'Faltan algunas borlas. Desgaste por uso normal.';
  if (normalized.includes('grieta en mango')) return 'Pequeña grieta en el mango; no afecta el funcionamiento. Desgaste por uso normal.';
  if (normalized.includes('paint stains')) return 'Manchas de pintura por uso.';
  if (normalized.includes('bent') && normalized.includes('discolored')) return 'Está doblada y presenta decoloración por uso.';
  if (normalized.includes('base reparada')) return 'Base reparada. Desgaste por uso normal.';
  if (normalized.includes('small chips')) return 'Pequeños saltados en la cerámica y manchas de agua. Desgaste por uso normal.';
  if (normalized.includes('regular wear')) return 'Desgaste por uso normal.';
  return value;
}

function parsedFunctionality(raw) {
  const whole = String(raw || '').toLowerCase();
  const value = rawField(raw, 'F').toLowerCase();
  if (value.includes('funciona muy bien')) return 'Funciona muy bien';
  if (value === 'works good' || value === 'good' || value === 'g' || value === 'funciona' || whole.includes('pump functions good')) return 'Funciona bien';
  return '';
}

function functionalityNeedsReview(raw) {
  const value = rawField(raw, 'F').toLowerCase();
  return ['regular', 'normal', 'fine'].includes(value);
}

function parsedQuantity(raw) {
  if (Number.isInteger(raw) && raw > 0) return raw;
  const values = String(raw || '').match(/\d+/g)?.map(Number) || [];
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function normalizedDimensions(raw) {
  const value = String(raw || '').trim();
  if (!value || /\?|coming soon|see pics|not avail/i.test(value)) return '';
  const clean = value.replace(/\s+/g, ' ').trim();
  const known = new Map([
    ['148 min -255 max', '148 a 255 cm'], ['55 min -98 max', '55 a 98 cm'],
    ['65 min -126 max', '65 a 126 cm'], ['67 min -126 max', '67 a 126 cm'],
    ['155 min - 210 max', '155 a 210 cm'], ['37x47', '37 × 47 cm'],
    ['20x29x6 pr', '20 × 29 × 6 cm'], ['57anx1,67 largo', '57 × 167 cm'],
    ['29 cm w x 29 cm l, depth not avail.', '29 × 29 cm; profundidad pendiente'],
    ['16x27x16', '16 × 27 × 16 cm'], ['35x24x7p', '35 × 24 × 7 cm'],
    ['14 cm alto', '14 cm de alto'], ['36 alto x 22 diametro', '36 cm de alto × 22 cm de diámetro'],
    ['181 anchox100 largo', '181 × 100 cm'], ['96anx148largo', '96 × 148 cm'],
    ['74x78', '74 × 78 cm'], ['18 diam', '18 cm de diámetro'], ['22diam', '22 cm de diámetro'],
    ['22 diam', '22 cm de diámetro'], ['268x180', '268 × 180 cm'], ['35 cm', '35 cm'],
    ['33ancho x 21alto x 26 pro', '33 × 21 × 26 cm'], ['3 metros', '3 m'],
    ['34 cm diam', '34 cm de diámetro'], ['22diam', '22 cm de diámetro'], ['28diam', '28 cm de diámetro'],
    ['54x36', '54 × 36 cm'], ['27 cm diam x 14 cm profundo', '27 cm de diámetro × 14 cm de profundidad'],
    ['15anx27largox7pr', '15 × 27 × 7 cm'], ['217 min x max cm (coming soon)', 'Largo mínimo: 217 cm'],
  ]);
  return known.get(clean) || clean.replaceAll('x', ' × ');
}

function translatedInclusions(raw) {
  if (!raw) return [];
  const translations = new Map([
    ['battery included', 'Pila'], ['tapa', 'Tapa'], ['2 larger hooks', '2 ganchos grandes'],
    ['hoses', 'Mangueras'], ['dryer rack', 'Rejilla de secado'], ['transportation bolts', 'Pernos de transporte'],
    ['height-adjust wrench', 'Llave para ajuste de altura'], ['rubber protectors', 'Protectores de goma'],
    ['lamp shade', 'Pantalla'], ['1 light bulb', '1 bombilla'], ['submersible pump', 'Bomba sumergible'],
    ['hose', 'Manguera'], ['wand', 'Lanza'], ['water filter adapter', 'Adaptador de filtro de agua'],
  ]);
  return String(raw).split(',').map(value => value.trim()).filter(Boolean).map(value => translations.get(value.toLowerCase()) || value);
}

function isNumericPrice(value) {
  return Number.isInteger(value) && value > 0;
}

const matchedRows = [];
const unmatchedRows = [];
const matchedItems = new Set();
let currentPricesImported = 0;
let quantitiesImported = 0;
let conditionsParsed = 0;
let specificDefectsParsed = 0;
let functionalityValuesParsed = 0;
let functionalityValuesStillNeedReview = 0;
let dimensionsImported = 0;
let dimensionsSkipped = 0;
let pickupModesImported = 0;
let inclusionNotesImported = 0;
let pricingReferencesImported = 0;

for (const row of workbookData.rows) {
  const itemNumber = findItemForRow(row);
  if (!itemNumber) {
    unmatchedRows.push({ rowNumber: row.rowNumber, sellerReferenceTitle: String(row.B || ''), photoReference: String(row.A || '') });
    if (!normalizedDimensions(row.G)) dimensionsSkipped += 1;
    continue;
  }
  matchedRows.push({ rowNumber: row.rowNumber, itemNumber, photoReferences: row.photoReferences });
  matchedItems.add(itemNumber);
  const product = productByItem.get(itemNumber);
  const review = reviewByItem.get(itemNumber);
  review.privateSellerReference = {
    spreadsheetRow: row.rowNumber, sellerReferenceTitle: row.B || '', sellerReferenceDescription: row.E || '',
    conditionDefectsFunctionalityRaw: row.F || '', originalPriceReferenceRaw: row.J || '',
  };
  review.flags = review.flags.filter(flag => !/^price: missing|^dimensions: missing|^condition: needs review|^functionality: unknown/i.test(flag));
  if (isNumericPrice(row.C)) {
    product.asking = row.C;
    currentPricesImported += 1;
  } else if (row.C) {
    review.flags.push(`La columna C de la planilla no contiene un precio numérico válido; confirmar el precio actual del Item ${itemNumber}.`);
  }
  const quantity = parsedQuantity(row.D);
  if (quantity) {
    product.quantityTotal = quantity;
    quantitiesImported += 1;
  }
  const condition = parsedCondition(row.F);
  if (condition) {
    product.condition = condition;
    conditionsParsed += 1;
  }
  const defect = specificDefect(row.F);
  if (defect) {
    product.knownDefects = defect;
    specificDefectsParsed += 1;
  } else if (!product.knownDefects && product.condition) {
    product.knownDefects = 'Desgaste por uso normal.';
  }
  const functionality = parsedFunctionality(row.F);
  if (functionality) {
    review.functionality = functionality;
    functionalityValuesParsed += 1;
  } else if (functionalityNeedsReview(row.F)) {
    review.functionality = '';
    review.flags.push(`La funcionalidad indicada para el Item ${itemNumber} es ambigua; confirmar antes de aprobar.`);
    functionalityValuesStillNeedReview += 1;
  }
  const dimensions = normalizedDimensions(row.G);
  if (dimensions) {
    review.dimensions = dimensions;
    dimensionsImported += 1;
  } else {
    dimensionsSkipped += 1;
  }
  const pickup = String(row.H || '').trim().toLowerCase();
  if (pickup === 'n' || pickup === 'l') {
    product.saleMode = pickup === 'n' ? 'IMMEDIATE' : 'DELAYED';
    pickupModesImported += 1;
  }
  const inclusions = translatedInclusions(row.I);
  if (inclusions.length) {
    product.includedAccessories = [...new Set([...product.includedAccessories, ...inclusions])];
    inclusionNotesImported += 1;
  }
  if (row.J !== null && row.J !== '') {
    review.pricingReference = String(row.J);
    pricingReferencesImported += 1;
  }
}

function applyProduct(itemNumber, changes) {
  Object.assign(productByItem.get(itemNumber), changes);
}

function replaceFlags(itemNumber, flags) {
  reviewByItem.get(itemNumber).flags = flags;
}

applyProduct(378, {
  title: 'Tope decorativo para puerta con diseño de gato',
  slug: `${slugify('Tope decorativo para puerta con diseño de gato')}-item-378`,
  description: 'Tope acolchado amarillo y verde con diseño de gato, pensado para evitar que una puerta se cierre completamente.',
  quantityTotal: 1,
  photos: ['/images/volume-4/v4-item-378-tope-gato.webp'],
});
replaceFlags(378, ['Confirmar el precio de venta del Item 378.', 'Confirmar condición y medidas.']);

applyProduct(385, {
  title: 'Recipiente plástico grande con tapa',
  slug: `${slugify('Recipiente plástico grande con tapa')}-item-385`,
  description: 'Recipiente plástico transparente de tamaño grande con tapa y cierres laterales. Dos unidades disponibles, vendidas por separado.',
  quantityTotal: 2,
  photos: ['/images/volume-4/v4-item-385-recipientes-grandes.webp'],
});
replaceFlags(385, ['El precio sugerido corresponde a cada unidad.', 'Confirmar capacidad y medidas del Item 385.']);

applyProduct(386, {
  title: 'Recipiente alto para alimentos secos',
  description: 'Recipiente alto transparente con tapa para cereales u otros alimentos secos. Las imágenes muestran dos perspectivas de la misma unidad.',
  quantityTotal: 1,
});
replaceFlags(386, ['Confirmar capacidad, medidas y precio del Item 386.']);

applyProduct(390, {
  title: 'Serrucho manual con mango plástico',
  slug: `${slugify('Serrucho manual con mango plástico')}-item-390`,
  description: 'Serrucho manual con hoja metálica y mango plástico. Las dos imágenes muestran lados opuestos de la misma herramienta.',
  quantityTotal: 1,
});
replaceFlags(390, ['Confirmar largo de la hoja, condición del filo y precio del Item 390.']);

applyProduct(393, {
  title: 'Espátula metálica de cocina',
  description: 'Espátula metálica manual para cocinar y servir. Las imágenes muestran el frente y el reverso de la misma pieza.',
  quantityTotal: 1,
});
replaceFlags(393, ['Confirmar condición y precio del Item 393.']);

applyProduct(403, {
  title: 'Juego de dos portavelas de vidrio',
  slug: `${slugify('Juego de dos portavelas de vidrio')}-item-403`,
  description: 'Juego de dos portavelas de vidrio transparente. Se venden juntos.',
  quantityTotal: 1,
  includedAccessories: ['2 portavelas de vidrio'],
});
replaceFlags(403, ['Confirmar precio del juego completo del Item 403.']);

applyProduct(404, {
  title: 'Gabinete alto para almacenamiento',
  slug: `${slugify('Gabinete alto para almacenamiento')}-item-404`,
  description: 'Gabinete alto para almacenamiento. La imagen muestra el mismo mueble con las puertas abiertas y cerradas.',
  quantityTotal: 1,
});
replaceFlags(404, ['Confirmar medidas, condición, contenido incluido y precio del Item 404.']);

replaceFlags(437, ['Confirmar si el Item 437 corresponde al mismo producto que el Item 422.', 'Falta medir el Item 437.']);

async function cropPhoto(sourceName, outputName, extract) {
  await sharp(path.join(intakeDir, sourceName)).rotate().extract(extract).resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).toColorspace('srgb').webp({ quality: 82 }).toFile(path.join(imageDir, outputName));
}

await Promise.all([
  cropPhoto('Vol 4 pic 109.JPG', 'v4-item-378-tope-gato.webp', { left: 0, top: 0, width: 1250, height: 1529 }),
  cropPhoto('Vol 4 pic 109.JPG', 'v4-item-507-topes-oscuros.webp', { left: 1250, top: 0, width: 1774, height: 1529 }),
  cropPhoto('Vol 4 pic 126.JPG', 'v4-item-385-recipientes-grandes.webp', { left: 0, top: 0, width: 2016, height: 3024 }),
  cropPhoto('Vol 4 pic 126.JPG', 'v4-item-508-recipientes-pequenos.webp', { left: 2016, top: 0, width: 2016, height: 3024 }),
]);

function splitProduct(sourceItem, itemNumber, title, description, quantity, photo) {
  const source = productByItem.get(sourceItem);
  const product = {
    ...source, id: `real-202610-volume4-${itemNumber}`, itemNumber,
    slug: `${slugify(title)}-item-${itemNumber}`, title, description, quantityTotal: quantity,
    photos: [photo], asking: null, status: 'NEEDS_REVIEW', needsReview: true,
  };
  products.push(product);
  productByItem.set(itemNumber, product);
  return product;
}

function splitReview(sourceItem, itemNumber, groupId, flags) {
  const source = reviewByItem.get(sourceItem);
  const review = { ...source, itemNumber, groupId, flags, coverIndex: 0, referenceImages: [...source.referenceImages], sourcePhotos: [...source.sourcePhotos] };
  reviews.push(review);
  reviewByItem.set(itemNumber, review);
  return review;
}

if (!productByItem.has(507)) {
  splitProduct(378, 507, 'Topes oscuros para puerta', 'Topes oscuros para mantener una puerta en posición. Dos unidades disponibles, vendidas por separado.', 2, '/images/volume-4/v4-item-507-topes-oscuros.webp');
  splitReview(378, 507, '052b', ['El precio sugerido corresponde a cada unidad.', 'Confirmar condición y medidas del Item 507.']);
}
if (!productByItem.has(508)) {
  splitProduct(385, 508, 'Recipiente plástico pequeño con tapa', 'Recipiente plástico transparente de tamaño pequeño con tapa y cierres laterales. Dos unidades disponibles, vendidas por separado.', 2, '/images/volume-4/v4-item-508-recipientes-pequenos.webp');
  splitReview(385, 508, '059b', ['El precio sugerido corresponde a cada unidad.', 'Confirmar capacidad y medidas del Item 508.']);
}

const retailResearch = new Map([
  [327, { retail: 'Gs. 10.808.700 nuevo en Universo (modelo WK14BS6R)', suggested: 7_500_000, fast: 6_800_000, confidence: 'Medium', comment: 'Referencia local exacta; propuesta de mudanza por debajo del precio nuevo.', sources: ['https://universo.com.py/electrodomesticos/lavasecarropas/torre-de-lavado-lg-1410-kg-inverter-negro-wk14bs6r-202664'] }],
  [328, { retail: 'Gs. 949.000 a 1.175.800 nueva en Paraguay', suggested: 600_000, fast: 500_000, confidence: 'High', comment: 'Modelo exacto identificado; precio usado conservador frente a referencias nuevas locales.', sources: ['https://movida.com.py/producto/aspiradora-wasko-hidrolavadora-bravo', 'https://www.chacomer.com.py/hogar/hidrolavadoras.html'] }],
  [424, { retail: 'Gs. 360.000 a 387.000 nueva en Paraguay para Coleman 16 qt', suggested: 220_000, fast: 180_000, confidence: 'High', comment: 'Capacidad y marca identificadas; propuesta de aproximadamente 60% del precio nuevo.', sources: ['https://www.pcsurvivalshop.com.py/categoria-producto/camping/conservadoras-y-termos/coleman-conservadoras-y-termos/', 'https://syopar.com.py/collections/conservadoras'] }],
  [427, { retail: 'Comparable Energizer Pro-360 nuevo: Gs. 250.000; confirmar modelo exacto', suggested: 120_000, fast: 95_000, confidence: 'Low', comment: 'Comparable de marca y uso, pero el modelo exacto del Item 427 todavía debe confirmarse.', sources: ['https://nissei.com/py/ferreteria-construccion/pintura-acabados-e-iluminacion/lamparas-focos-y-linternas/linterna-energizer-wheathready-pro-360-500-lumenes-black'] }],
  [449, { retail: 'Referencia internacional nueva: USD 14,17 para Plomer PD-210', suggested: 60_000, fast: 45_000, confidence: 'Medium', comment: 'Modelo exacto identificado; referencia internacional ajustada de forma conservadora para venta local usada.', sources: ['https://www.homedepot.com.mx/p/destapacanos-cinta-plana-6-cm-x-600-cm-negro-pd-210-529397'] }],
  [475, { retail: 'Comparables locales anunciados: Gs. 25.500.000 a 32.000.000', suggested: 27_500_000, fast: 25_000_000, confidence: 'Medium', comment: 'Rango basado en Rexton 2002 anunciadas localmente; kilometraje, documentos y estado final deben confirmarse.', sources: ['https://motor.com.py/anuncio/ssangyong-camioneta-2002-asuncion-cmqq18wkk002mtmvsj37ev9oa', 'https://clasipar.paraguay.com/motor/autos/hermoso-ssangyong-rexton-turbo-diesel-2900-automatico-4x4-titulo-cd-verde-impecable-estado-2357631'] }],
]);

const manualSuggestions = new Map([
  [378, 25_000], [385, 50_000], [386, 40_000], [390, 65_000], [393, 25_000],
  [403, 30_000], [404, 450_000], [507, 20_000], [508, 35_000],
]);

const categoryBase = new Map([
  ['Accesorios', 50_000], ['Accesorios personales', 50_000], ['Cocina', 55_000], ['Decoración', 65_000],
  ['Electrodomésticos', 300_000], ['Electrónica', 100_000], ['Herramientas', 90_000], ['Hogar', 65_000],
  ['Jardín', 80_000], ['Juegos', 50_000], ['Manualidades', 45_000], ['Muebles', 450_000], ['Oficina', 45_000],
  ['Otros', 60_000], ['Salud y cuidado personal', 70_000],
]);

function roundedPrice(value) {
  return Math.max(10_000, Math.round(value / 5_000) * 5_000);
}

function paidPrice(reference) {
  const raw = String(reference || '');
  if (/USD|\$/i.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

for (const product of products) {
  const review = reviewByItem.get(product.itemNumber);
  const researched = retailResearch.get(product.itemNumber);
  let suggested = researched?.suggested;
  let confidence = researched?.confidence;
  let comment = researched?.comment;
  let fast = researched?.fast;
  if (!suggested) {
    const paid = paidPrice(review.pricingReference);
    let basis = categoryBase.get(product.category) || 50_000;
    if (product.condition === 'Estado regular') basis *= 0.75;
    if (product.condition === 'Muy buen estado') basis *= 1.15;
    if (paid) basis = Math.min(basis, paid * 0.65);
    suggested = manualSuggestions.get(product.itemNumber) || roundedPrice(basis);
    fast = roundedPrice(suggested * 0.8);
    confidence = paid ? 'Medium' : 'Low';
    const perUnit = product.quantityTotal > 1 && /por separado|por unidad/i.test(product.description);
    comment = `${paid ? 'Usa la referencia de precio original y el estado registrado.' : 'Estimación conservadora por categoría, condición y formato de venta.'}${perUnit ? ' Precio sugerido por unidad.' : ''}`;
  }
  review.currentSellerAskingPrice = product.asking;
  review.originalPriceReference = review.pricingReference || '';
  review.currentRetailReference = researched?.retail || '';
  review.suggestedAskingPrice = suggested;
  review.pricingComment = comment;
  review.pricingConfidence = confidence;
  review.fastSalePrice = fast;
  review.pricingSources = researched?.sources || [];
}

const ownerFacingFlagReplacements = new Map([
  ['Las fotos muestran otros moldes; confirmar cuáles se incluyen en esta venta.', 'Las imágenes del Item 350 muestran otros moldes; confirmar cuáles se incluyen en esta venta.'],
  ['Faltan las fotos adicionales y los accesorios que el propietario planea proporcionar.', 'Faltan las imágenes adicionales y los accesorios previstos para el Item 387.'],
  ['No se fusionó con la foto 217 por falta de evidencia suficiente.', 'El Item 422 no se fusionó con el Item 437 por falta de evidencia suficiente.'],
  ['Reemplazar o actualizar la foto 212 antes de publicar.', 'Reemplazar o actualizar la imagen principal del Item 435 antes de publicar.'],
  ['Las fotos confirman dos tipos de guantes; confirmar tamaños, cantidades restantes y si se venden juntos.', 'Las imágenes del Item 446 muestran dos tipos de guantes; confirmar tamaños, cantidades restantes y si se venden juntos.'],
  ['Confirmar cantidad y si se combina con la foto 222.', 'Confirmar si el Item 452 debe combinarse con el Item 440.'],
]);
for (const review of reviews) {
  review.flags = [...new Set(review.flags.map(flag => ownerFacingFlagReplacements.get(flag) || flag))];
}

products.sort((a, b) => a.itemNumber - b.itemNumber);
reviews.sort((a, b) => a.itemNumber - b.itemNumber);

const groupingPattern = /confirmar si|corresponde al mismo producto|modalidad de venta|se venden juntas|se vende como|combina con/i;
const bookkeepingPattern = /precio sugerido corresponde|precio de venta|precio actual|reference-only|solo de referencia/i;
const unresolvedGrouping = reviews.filter(review => review.flags.some(flag => groupingPattern.test(flag))).map(review => ({ itemNumber: review.itemNumber, flags: review.flags.filter(flag => groupingPattern.test(flag)) }));
const unresolvedSellerFacts = reviews.filter(review => review.flags.some(flag => !groupingPattern.test(flag) && !bookkeepingPattern.test(flag))).map(review => ({ itemNumber: review.itemNumber, flags: review.flags.filter(flag => !groupingPattern.test(flag) && !bookkeepingPattern.test(flag)) }));

payload.generatedAt = new Date().toISOString();
payload.products = products;
payload.reviews = reviews;
payload.reconciliation.spreadsheetDataRows = workbookData.rows.length;
payload.reconciliation.spreadsheetRowsMatched = matchedRows.length;
payload.reconciliation.spreadsheetRowsUnmatched = unmatchedRows.length;
payload.reconciliation.matchedSpreadsheetRows = matchedRows;
payload.reconciliation.unmatchedSpreadsheetRows = unmatchedRows;
payload.reconciliation.ownerConfirmedSplits = { item378: [378, 507], item385: [385, 508] };
payload.spreadsheetMetrics = {
  rowsParsed: workbookData.rows.length, rowsMatched: matchedRows.length, rowsUnmatched: unmatchedRows.length,
  titlesReconciled: matchedItems.size, descriptionsReconciled: matchedItems.size,
  currentPricesImported, quantitiesImported, conditionsParsed, specificDefectsParsed,
  functionalityValuesParsed, functionalityValuesStillNeedReview, dimensionsImported, dimensionsSkipped,
  pickupModesImported, inclusionNotesImported, pricingReferencesImported,
};
payload.pricingMetrics = {
  itemsWithCurrentSellerAskingPrice: products.filter(product => product.asking !== null).length,
  itemsWithSuggestedAskingPrice: reviews.filter(review => Number.isInteger(review.suggestedAskingPrice)).length,
  itemsWithCurrentRetailReference: reviews.filter(review => review.currentRetailReference).length,
  itemsWithPricingComment: reviews.filter(review => review.pricingComment).length,
  highConfidence: reviews.filter(review => review.pricingConfidence === 'High').length,
  mediumConfidence: reviews.filter(review => review.pricingConfidence === 'Medium').length,
  lowConfidence: reviews.filter(review => review.pricingConfidence === 'Low').length,
};
payload.unresolved = {
  grouping: unresolvedGrouping,
  sellerFacts: unresolvedSellerFacts,
  missingPrices: products.filter(product => product.asking === null).map(product => product.itemNumber),
  missingSuggestedPrices: reviews.filter(review => !Number.isInteger(review.suggestedAskingPrice)).map(review => review.itemNumber),
  missingQuantities: products.filter(product => !Number.isInteger(product.quantityTotal) || product.quantityTotal < 1).map(product => product.itemNumber),
  missingMeasurements: reviews.filter(review => !review.dimensions).map(review => review.itemNumber),
  missingPickupTiming: products.filter(product => !['IMMEDIATE', 'DELAYED'].includes(product.saleMode)).map(product => product.itemNumber),
  missingCondition: products.filter(product => !product.condition).map(product => product.itemNumber),
  unresolvedDefects: products.filter(product => !product.knownDefects).map(product => product.itemNumber),
  unresolvedFunctionality: reviews.filter(review => !review.functionality && /Electrodomésticos|Electrónica|Herramientas/.test(productByItem.get(review.itemNumber)?.category || '')).map(review => review.itemNumber),
  photoReplacements: [435],
};

const existingProducts = await loadExistingProducts(root);
payload.validation = await validateCatalog({ root, existingProducts, pilotProducts: products, intakeReport: payload.images });
payload.validation.spreadsheetRowsParsed = workbookData.rows.length === 75;
payload.validation.spreadsheetRowsReconciled = matchedRows.length + unmatchedRows.length === workbookData.rows.length;
payload.validation.referenceOnlyPhotosPreserved = payload.referenceImages.length === 9 && products.every(product => product.photos.every(photo => !photo.includes('.volume4-pilot/reference-images')));
payload.validation.allNeedsReview = products.every(product => product.status === 'NEEDS_REVIEW' && product.needsReview === true);
payload.validation.publicProjection = products.filter(product => product.status !== 'NEEDS_REVIEW' && product.status !== 'UNLISTED').length;

await writeBatchModule(batchPath, products);
await writeReports(reportDir, payload);
await writeFile(reportPath, JSON.stringify(payload, null, 2), 'utf8');

const workbookAfter = await stat(workbookPath);
if (workbookBefore.size !== workbookAfter.size || workbookBefore.mtimeMs !== workbookAfter.mtimeMs) throw new Error('Private workbook changed during reconciliation.');

process.stdout.write(`${JSON.stringify({ ok: true, products: products.length, spreadsheetMetrics: payload.spreadsheetMetrics, pricingMetrics: payload.pricingMetrics, unresolved: Object.fromEntries(Object.entries(payload.unresolved).map(([key, value]) => [key, value.length])), validation: payload.validation }, null, 2)}\n`);
