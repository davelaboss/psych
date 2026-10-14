import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  loadExistingProducts, slugify, validateCatalog, writeBatchModule, writeReports,
} from './workflow.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const reportDir = path.join(root, 'volume4/review-output');
const reportPath = path.join(reportDir, 'real-intake-report.json');
const statePath = path.join(reportDir, 'final-owner-review-state.json');
const batchPath = path.join(root, 'source/lib/volume4-batch.mjs');
const handoffPath = path.join(root, 'volume4/production-handoff.json');
const payload = JSON.parse(await readFile(reportPath, 'utf8'));
const ownerState = JSON.parse(await readFile(statePath, 'utf8'));
const handoff = JSON.parse(await readFile(handoffPath, 'utf8'));

if (payload.products.length !== 175 || payload.reviews.length !== 175) {
  throw new Error('Expected the final 175-product Volume 4 state.');
}

const productByItem = new Map(payload.products.map(product => [product.itemNumber, product]));
const reviewByItem = new Map(payload.reviews.map(review => [review.itemNumber, review]));
const retiredIds = [342, 420, 437, 442, 444, 469, 507, 509];
const expectedPendingApprovalReconciliation = [336, 341, 378, 379, 382, 389, 405, 419, 422, 423, 430];
const statusSnapshot = structuredClone(ownerState.statuses);
const factualSnapshot = new Map(payload.products.map(product => [product.itemNumber, {
  asking: product.asking,
  quantityTotal: product.quantityTotal,
  saleMode: product.saleMode,
  pickupDate: product.pickupDate,
  pickupWindowStart: product.pickupWindowStart,
  pickupWindowEnd: product.pickupWindowEnd,
  includedAccessories: structuredClone(product.includedAccessories),
  notIncludedVisible: product.notIncludedVisible,
  condition: product.condition,
  photos: structuredClone(product.photos),
}]));

const textCorrections = {
  334: { title: 'Bol de vidrio con tapa azul de 2,5 L' },
  336: {
    title: 'Kit de barra negra de cocina con ganchos (por unidad)',
    description: 'Barra metálica negra para colgar utensilios de cocina, como cucharones y espátulas. Hay 3 kits disponibles; se venden por separado. Precio por unidad. Cada kit incluye 1 barra, 2 soportes de pared, 2 ganchos grandes de aproximadamente 11 cm, 5 ganchos pequeños de aproximadamente 7 cm y herrajes pequeños de montaje.',
  },
  337: { description: 'Recipiente plástico para transportar y conservar tortas, con tapa y servilleta de adorno.' },
  343: {
    title: 'Olla de cocción lenta Chup Chup Matic de 5,5 L con funda',
    description: 'Olla eléctrica de cocción lenta de 5,5 L con tapa de vidrio y funda.',
  },
  349: { title: 'Olla a presión Tramontina de 5 L' },
  350: {
    title: 'Molde rectangular Wilton y otros moldes para hornear',
    description: 'Molde metálico rectangular Wilton para pan o pastel de carne, junto con otros moldes para preparaciones al horno.',
  },
  351: { title: 'Bol blanco OXO con base de goma' },
  352: {
    title: 'Sartén Lodge de hierro fundido de 21 cm de diámetro',
    description: 'Sartén Lodge de hierro fundido de 21 cm de diámetro, con pico vertedor y mango largo.',
  },
  353: {
    title: 'Surtido de papel manteca, filme y bolsa para cocinar',
    description: 'Surtido de consumibles para envolver y guardar alimentos. El papel manteca y el filme están sin abrir.',
  },
  355: {
    title: 'Canasta plástica (por unidad)',
    description: 'Hay 2 canastas plásticas disponibles: una rosa y otra color durazno. Se venden individualmente. Precio por unidad.',
  },
  362: {
    title: 'Recipiente transparente con tapa marrón (por unidad)',
    description: 'Recipiente transparente para almacenamiento con tapa marrón. Hay 2 unidades disponibles; se venden por separado. Precio por unidad.',
  },
  369: { description: 'Dos recipientes cerámicos blancos con tapa para hornear.' },
  370: { description: 'Paraguas plegable con estampado de cebra.' },
  375: { description: 'Paraguas plegable azul con diseño a cuadros; incluye funda y capa para lluvia.' },
  378: { description: 'Tope acolchado amarillo con diseño de gato, pensado para evitar que una puerta se cierre completamente, y 2 topes negros tradicionales para detener la puerta.' },
  380: { knownDefects: 'Desgaste por uso normal. A la tapa del recipiente plástico le falta uno de los cuatro sujetadores, pero aun así cierra bien.' },
  381: {
    title: 'Recipiente de vidrio con tapa (por unidad)',
    description: 'Recipiente de vidrio para alimentos con tapa. Hay 2 unidades disponibles; se venden por separado. Precio por unidad.',
  },
  382: { knownDefects: 'Ruedas dañadas, pero el bolso aún se desplaza. Desgaste por uso normal.' },
  383: {
    description: 'Extintor portátil para uso doméstico.',
    knownDefects: 'Debe recargarse porque la carga está vencida. Desgaste por uso normal.',
  },
  385: {
    title: 'Recipiente plástico grande con tapa (por unidad)',
    description: 'Recipiente plástico transparente de tamaño grande con tapa y cierres laterales. Hay 2 unidades disponibles; se venden por separado. Precio por unidad.',
  },
  386: { description: 'Recipiente alto transparente con tapa hermética para cereales u otros alimentos secos.' },
  387: { knownDefects: 'Desgaste por uso normal. Una de las unidades contiene manchas.' },
  388: { description: 'Juego de protectores rectangulares individuales y posavasos, 10 de cada uno, con diseño de tazas.' },
  389: { knownDefects: 'Ninguno conocido.' },
  390: {
    title: 'Serrucho manual de 18 pulgadas con mango de madera',
    description: 'Serrucho manual con hoja metálica de 18 pulgadas y mango de madera.',
  },
  392: { description: 'Dos bolsas de sustrato para jardinería. Una bolsa está sin abrir y contiene 5 kg. La otra aún contiene aproximadamente entre 2 y 3 kg.' },
  393: {
    title: 'Espátula metálica Tramontina para parrilla',
    description: 'Espátula metálica manual Tramontina para parrilla, con poco uso.',
  },
  400: {
    title: 'Barra extensible para cortina de baño (por unidad)',
    description: 'Barra plástica extensible para cortina de baño. Hay 2 unidades disponibles; se venden por separado. Precio por unidad.',
  },
  408: { title: 'Funda azul para almohada', description: 'Funda azul para almohada.' },
  409: { description: 'Surtido de bolsas y carteritas.' },
  412: { description: 'Funda negra artesanal de tela, confeccionada en Camboya, para libro o Biblia de tamaño grande.' },
  413: { description: 'Colchón inflable Intex de tamaño individual en su empaque. Incluye una bomba de aire manual dentro del empaque.' },
  418: { knownDefects: 'Falta una borla. Desgaste por uso normal.' },
  419: { title: 'Bolso gris portabebidas', description: 'Bolso gris flexible para llevar bebidas.' },
  421: { description: 'Funda para almohada disponible en varios colores. Se venden por separado; el comprador puede elegir el color.' },
  432: { description: 'Conjunto de artículos básicos de primeros auxilios: 2 tapabocas N95, 1 paquete de Etidol para aliviar el dolor y 26 paquetes individuales de almohadillas con alcohol.' },
  436: { description: 'Luz a pilas con sensor de movimiento para iluminación auxiliar, 12 luces LED y resistencia a la intemperie. Incluye cuatro pilas tipo D.' },
  446: { knownDefects: 'Las dos cajas están usadas. La caja de guantes negros contiene menos de 100 unidades.' },
  452: { description: 'Conjunto de tarjetas y sobres de varios colores y tamaños. La mayoría está en inglés y corresponde a diferentes ocasiones.' },
  463: {
    title: 'Surtido de papel cuadriculado, lápices y 4 hojas de papel carbón',
    description: 'Conjunto de blocs de papel cuadriculado, lápices y 4 hojas de papel carbón.',
  },
  465: { title: 'Surtido de cartulinas y papel común en varios colores' },
  466: {
    title: 'Caja plástica blanca Sterilite con tapa (por unidad)',
    description: 'Caja plástica transparente con tapa blanca Sterilite para almacenamiento. Hay 3 unidades disponibles; se venden individualmente. Precio por unidad: Gs. 42.000.',
  },
  468: {
    title: 'Surtido de fundas plásticas para documentos de tres y cuatro anillos',
    description: 'Conjunto de fundas plásticas de tres y cuatro anillos para archivar documentos.',
  },
  480: { knownDefects: 'Desgaste por uso normal. Falta uno de los tres protectores de silicona o goma de las patas metálicas, pero no afecta la funcionalidad.' },
  482: { knownDefects: 'Desgaste por uso normal. Falta la manija superior, pero no afecta su función.' },
  508: {
    title: 'Recipiente plástico pequeño con tapa (por unidad)',
    description: 'Recipiente plástico transparente de tamaño pequeño con tapa y cierres laterales. Hay 2 unidades disponibles; se venden por separado. Precio por unidad.',
  },
};

const measurementCorrections = {
  332: '19,5 × 19,5 cm',
  352: '21 cm de diámetro',
  363: 'Pedestal: 58 cm de alto; fuente: 29 cm de ancho × 55 cm de alto',
  402: 'Aproximadamente 4 m',
  413: '99 × 191 × 22 cm',
  424: '36 cm de ancho × 36 cm de alto × 23 cm de profundidad',
  449: '6,3 mm de ancho × 6 m de largo',
  485: '26 cm de diámetro',
  486: '26 cm de diámetro',
  495: 'Pequeños: 17 cm de diámetro; medianos: 21,5 cm de diámetro',
  496: '40 × 27 × 23 cm',
};

function numericSignature(value) {
  return [...String(value || '').matchAll(/\d+(?:[.,]\d+)?/g)].map(match => Number(match[0].replace(',', '.')));
}

for (const [itemNumberText, correction] of Object.entries(textCorrections)) {
  const itemNumber = Number(itemNumberText);
  const product = productByItem.get(itemNumber);
  if (!product) throw new Error(`Missing Item ${itemNumber} for copy normalization.`);
  Object.assign(product, correction);
  if (correction.title) product.slug = `${slugify(product.title)}-item-${itemNumber}`;
}

for (const [itemNumberText, dimensions] of Object.entries(measurementCorrections)) {
  const itemNumber = Number(itemNumberText);
  const review = reviewByItem.get(itemNumber);
  if (!review) throw new Error(`Missing Item ${itemNumber} review for measurement normalization.`);
  const beforeNumbers = numericSignature(review.dimensions);
  const afterNumbers = numericSignature(dimensions);
  if (JSON.stringify(beforeNumbers) !== JSON.stringify(afterNumbers)) {
    throw new Error(`Item ${itemNumber} measurement values changed during formatting normalization.`);
  }
  review.dimensions = dimensions;
}

for (const product of payload.products) {
  const review = reviewByItem.get(product.itemNumber);
  ownerState.edits[product.itemNumber] = {
    ...ownerState.edits[product.itemNumber],
    title: product.title,
    category: product.category,
    price: product.asking,
    description: product.description,
    condition: product.condition,
    defects: product.knownDefects,
    functionality: review.functionality,
    dimensions: review.dimensions,
    quantity: product.quantityTotal,
    pickupMode: product.saleMode,
    includedAccessories: [...product.includedAccessories],
    coverIndex: review.coverIndex,
  };
  ownerState.statuses[product.itemNumber] = 'approved';
}

const statusesChanged = Object.keys(ownerState.statuses)
  .filter(itemNumber => ownerState.statuses[itemNumber] !== statusSnapshot[itemNumber])
  .map(Number);
if (statusesChanged.length && JSON.stringify(statusesChanged) !== JSON.stringify(expectedPendingApprovalReconciliation)) {
  throw new Error(`Unexpected status reconciliation scope: ${statusesChanged.join(', ')}`);
}
ownerState.latestOwnerDecision = 'Authoritative final owner state reconciled to 175 approved products before mechanical production-style copy normalization.';

for (const product of payload.products) {
  const before = factualSnapshot.get(product.itemNumber);
  for (const field of ['asking', 'quantityTotal', 'saleMode', 'pickupDate', 'pickupWindowStart', 'pickupWindowEnd', 'notIncludedVisible', 'condition']) {
    if (JSON.stringify(product[field]) !== JSON.stringify(before[field])) throw new Error(`Item ${product.itemNumber}: ${field} changed.`);
  }
  for (const field of ['includedAccessories', 'photos']) {
    if (JSON.stringify(product[field]) !== JSON.stringify(before[field])) throw new Error(`Item ${product.itemNumber}: ${field} changed.`);
  }
}

const publicStrings = payload.products.flatMap(product => [
  product.title, product.description, product.condition, product.conditionNotes,
  product.knownDefects, ...(product.includedAccessories || []), product.notIncludedVisible,
].filter(Boolean).map(value => ({ itemNumber: product.itemNumber, value })));
const internalLeakage = /\b(?:todo|needs review|reviewer|confidence|pending review|pendiente de revisión|owner-confirmed|seller-confirmed|generad[oa] por (?:ia|inteligencia artificial))\b/i;
const accidentalEnglish = /\b(?:pack|small|medium|large size|sold separately|price per unit|set of|good condition|needs review)\b/i;
const leakageHits = publicStrings.filter(entry => internalLeakage.test(entry.value));
const englishHits = publicStrings.filter(entry => accidentalEnglish.test(entry.value));
const unpunctuatedDescriptions = payload.products.filter(product => !/[.!?…]$/.test(product.description.trim())).map(product => product.itemNumber);
if (leakageHits.length) throw new Error(`Public internal-note leakage remains in Items ${leakageHits.map(hit => hit.itemNumber).join(', ')}.`);
if (englishHits.length) throw new Error(`Accidental English remains in Items ${englishHits.map(hit => hit.itemNumber).join(', ')}.`);
if (unpunctuatedDescriptions.length) throw new Error(`Descriptions without terminal punctuation: ${unpunctuatedDescriptions.join(', ')}.`);

const perUnitItems = [336, 355, 362, 381, 385, 400, 466, 508];
for (const itemNumber of perUnitItems) {
  const product = productByItem.get(itemNumber);
  if (!product.title.endsWith('(por unidad)') || !/Precio por unidad(?:\.|:)/.test(product.description)) {
    throw new Error(`Item ${itemNumber} does not follow the per-unit production convention.`);
  }
}
const bundledItems = [354, 377, 380, 403, 448, 479, 485, 486, 487, 488, 489, 492, 495];
if (bundledItems.some(itemNumber => productByItem.get(itemNumber).title.includes('(por unidad)'))) {
  throw new Error('A set, pair, or assortment was incorrectly marked per unit.');
}

if (retiredIds.some(itemNumber => productByItem.has(itemNumber))) throw new Error('A retired Item ID reappeared.');
if (productByItem.get(389).title !== 'Sierra para metales'
  || productByItem.get(389).category !== 'Herramientas'
  || productByItem.get(389).asking !== 20_000
  || productByItem.get(389).condition !== 'Estado regular'
  || reviewByItem.get(389).functionality !== 'Funciona bien'
  || productByItem.get(389).knownDefects !== 'Ninguno conocido.') throw new Error('Item 389 owner facts changed.');
if (productByItem.get(333).title !== 'Vaso térmico Rubbermaid de 500 mL' || reviewByItem.get(333).dimensions !== '19 cm de alto') throw new Error('Item 333 owner facts changed.');
if (reviewByItem.get(356).dimensions !== '36 × 36 cm') throw new Error('Item 356 owner measurement changed.');
if (ownerState.statuses[330] !== 'approved') throw new Error('Item 330 approval changed.');
if (!productByItem.get(435).photos.length) throw new Error('Item 435 current photo was lost.');
if (handoff.item423?.requiredStatus !== 'SOLD' || handoff.item423?.publicAvailabilityAllowed !== false) throw new Error('Item 423 SOLD handoff changed.');
if (ownerState.statuses[468] !== 'approved' || !productByItem.get(468).photos[2].endsWith('v4-g143-02-rotated-ccw.webp')) throw new Error('Item 468 final correction changed.');

payload.generatedAt = new Date().toISOString();
payload.ownerReviewState = ownerState;
payload.statusAudit = {
  ...payload.statusAudit,
  approvedCount: 175,
  reReviewCount: 0,
  missingCount: 0,
  reReviewReasons: {},
  finalOwnerApprovalReconciliation: expectedPendingApprovalReconciliation,
};
payload.unresolved = {
  ...payload.unresolved,
  ownerSpotCheck: [],
  ownerQuestions: [],
};
payload.copyNormalization = {
  productionConventionConfirmed: true,
  productsMechanicallyCorrected: Object.keys(textCorrections).map(Number),
  englishCorrected: [432, 495],
  perUnitCorrected: perUnitItems,
  measurementFormattingCorrected: [332, 334, 343, 352, 363, 402, 413, 424, 449, 485, 486, 495, 496],
  ambiguitiesRequiringOwnerInput: {},
  factsChanged: false,
  pricesChanged: false,
  quantitiesChanged: false,
  saleStructuresChanged: false,
  photosChanged: false,
};

const existingProducts = await loadExistingProducts(root);
payload.validation = await validateCatalog({
  root,
  existingProducts,
  pilotProducts: payload.products,
  intakeReport: payload.images,
});
payload.validation.allNeedsReview = payload.products.every(product => product.status === 'NEEDS_REVIEW' && product.needsReview === true);
payload.validation.publicProjection = payload.products.filter(product => !['NEEDS_REVIEW', 'UNLISTED'].includes(product.status)).length;
payload.validation.ownerReviewStateCoverage = ownerState.editCount === payload.products.length && ownerState.statusCount === payload.products.length;
payload.validation.allOwnerApproved = Object.values(ownerState.statuses).every(status => status === 'approved');
payload.validation.retiredIdsAbsent = retiredIds.every(itemNumber => !productByItem.has(itemNumber));
payload.validation.copyNormalization = {
  noInternalLeakage: leakageHits.length === 0,
  noAccidentalEnglish: englishHits.length === 0,
  descriptionsPunctuated: unpunctuatedDescriptions.length === 0,
  perUnitConventionApplied: true,
  bundledItemsNotMarkedPerUnit: true,
  immutableFactsPreserved: true,
  zeroOutstandingOwnerQuestions: payload.unresolved.ownerQuestions.length === 0
    && Object.keys(payload.copyNormalization.ambiguitiesRequiringOwnerInput).length === 0,
};
if (!payload.validation.allNeedsReview || payload.validation.publicProjection !== 0 || !payload.validation.allOwnerApproved) {
  throw new Error('Final local publication/review safeguards failed.');
}

await writeBatchModule(batchPath, payload.products, ownerState);
await writeFile(statePath, JSON.stringify(ownerState, null, 2), 'utf8');
await writeFile(reportPath, JSON.stringify(payload, null, 2), 'utf8');
await writeReports(reportDir, payload);

process.stdout.write(`${JSON.stringify({
  ok: true,
  activeProducts: payload.products.length,
  approved: Object.values(ownerState.statuses).filter(status => status === 'approved').length,
  otherStatuses: Object.values(ownerState.statuses).filter(status => status !== 'approved').length,
  statusesChanged,
  copyNormalization: payload.copyNormalization,
  validation: payload.validation,
}, null, 2)}\n`);
