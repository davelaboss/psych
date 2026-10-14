import path from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import {
  loadExistingProducts, slugify, validateCatalog, writeBatchModule, writeReports,
} from './workflow.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const reportDir = path.join(root, 'volume4/review-output');
const reportPath = path.join(reportDir, 'real-intake-report.json');
const preservedStatePath = path.join(reportDir, 'owner-review-state.json');
const finalStatePath = path.join(reportDir, 'final-owner-review-state.json');
const batchPath = path.join(root, 'source/lib/volume4-batch.mjs');
const imageDir = path.join(root, 'images/volume-4');
const referenceDir = path.join(root, '.volume4-pilot/reference-images');

const payload = JSON.parse(await readFile(reportPath, 'utf8'));
const preserved = JSON.parse(await readFile(preservedStatePath, 'utf8'));
if (payload.products.length !== 182) throw new Error(`Expected 182 starting products, found ${payload.products.length}.`);
if (Math.max(...payload.products.map(product => product.itemNumber)) !== 508) throw new Error('Item 509 is not the next unused immutable ID.');
if (preserved.editCount !== 175 || preserved.statusCount !== 176) throw new Error('Preserved owner review snapshot does not match the recovered 175 edits / 176 statuses.');

const products = payload.products.map(product => ({
  ...product,
  photos: [...product.photos],
  includedAccessories: [...(product.includedAccessories || [])],
}));
const reviews = payload.reviews.map(review => ({
  ...review,
  flags: [...(review.flags || [])],
  sourcePhotos: [...(review.sourcePhotos || [])],
  referenceImages: [...(review.referenceImages || [])],
  pricingSources: [...(review.pricingSources || [])],
}));
const productByItem = new Map(products.map(product => [product.itemNumber, product]));
const reviewByItem = new Map(reviews.map(review => [review.itemNumber, review]));

function applyEdit(itemNumber, edit) {
  const product = productByItem.get(itemNumber);
  const review = reviewByItem.get(itemNumber);
  if (!product || !review || !edit) return;
  Object.assign(product, {
    title: edit.title,
    slug: `${slugify(edit.title)}-item-${itemNumber}`,
    category: edit.category,
    asking: edit.price === '' || edit.price === null ? null : edit.price,
    description: edit.description,
    condition: edit.condition,
    knownDefects: edit.defects,
    quantityTotal: edit.quantity,
    saleMode: edit.pickupMode,
    includedAccessories: [...(edit.includedAccessories || [])],
  });
  Object.assign(review, {
    functionality: edit.functionality,
    dimensions: edit.dimensions,
    coverIndex: edit.coverIndex,
    currentSellerAskingPrice: edit.price === '' || edit.price === null ? null : edit.price,
  });
}

for (const [itemNumber, edit] of Object.entries(preserved.edits)) applyEdit(Number(itemNumber), edit);

function unique(values) {
  return [...new Set(values)];
}

function consolidate(fromItem, toItem) {
  const sourceProduct = productByItem.get(fromItem);
  const targetProduct = productByItem.get(toItem);
  const sourceReview = reviewByItem.get(fromItem);
  const targetReview = reviewByItem.get(toItem);
  if (!sourceProduct || !targetProduct || !sourceReview || !targetReview) throw new Error(`Cannot consolidate ${fromItem} into ${toItem}.`);
  targetProduct.photos = unique([...targetProduct.photos, ...sourceProduct.photos]);
  targetReview.sourcePhotos = unique([...targetReview.sourcePhotos, ...sourceReview.sourcePhotos]);
  targetReview.referenceImages = unique([...targetReview.referenceImages, ...sourceReview.referenceImages]);
  productByItem.delete(fromItem);
  reviewByItem.delete(fromItem);
}

for (const [fromItem, toItem] of [[342, 341], [507, 378], [444, 405], [420, 419], [437, 422], [469, 468]]) consolidate(fromItem, toItem);

const item442 = productByItem.get(442);
const review442 = reviewByItem.get(442);
if (item442.photos.length !== 2 || review442.sourcePhotos.length !== 2) throw new Error('Item 442 no longer has the expected two-photo split source.');
const greenPhoto = item442.photos[1];
const greenSource = review442.sourcePhotos[1];
item442.photos = [item442.photos[0]];
review442.sourcePhotos = [review442.sourcePhotos[0]];
Object.assign(item442, {
  title: 'Malla media sombra negra',
  slug: 'malla-media-sombra-negra-item-442',
  description: 'Mallas negras tipo media sombra para jardín, patio u otras áreas exteriores.',
});
Object.assign(review442, {
  dimensions: 'Piezas: 285 × 150 cm; 280 × 195,3 cm; 188 × 170 cm',
  coverIndex: 0,
});

const item509 = {
  ...item442,
  id: 'real-202610-volume4-509',
  itemNumber: 509,
  slug: 'malla-media-sombra-verde-item-509',
  title: 'Malla media sombra verde',
  description: 'Malla verde tipo media sombra para jardín, patio u otras áreas exteriores.',
  photos: [greenPhoto],
  asking: null,
  quantityTotal: 1,
  includedAccessories: [],
};
const review509 = {
  ...review442,
  itemNumber: 509,
  groupId: '116b',
  sourcePhotos: [greenSource],
  dimensions: '243 × 95 cm',
  coverIndex: 0,
  flags: ['Confirmar el precio de venta del Item 509.'],
  currentSellerAskingPrice: null,
  originalPriceReference: '',
  currentRetailReference: '',
  suggestedAskingPrice: 80_000,
  fastSalePrice: 65_000,
  pricingComment: 'Propuesta orientativa por categoría; falta confirmación final del propietario.',
  pricingConfidence: 'Low',
  pricingSources: [],
  privateSellerReference: null,
};
productByItem.set(509, item509);
reviewByItem.set(509, review509);

Object.assign(productByItem.get(389), {
  title: 'Sierra para metales',
  slug: 'sierra-para-metales-item-389',
  category: 'Herramientas',
  description: 'Sierra manual con arco metálico y mango plástico para cortar metales.',
  asking: 20_000,
  condition: 'Estado regular',
  knownDefects: 'Ninguno conocido',
  includedAccessories: [],
  quantityTotal: 1,
});
Object.assign(reviewByItem.get(389), {
  functionality: 'Funciona bien',
  dimensions: '',
  currentSellerAskingPrice: null,
  suggestedAskingPrice: 90_000,
  fastSalePrice: 70_000,
  pricingComment: 'Propuesta orientativa para una sierra manual; confirmar precio y estado con el propietario.',
  pricingConfidence: 'Low',
  flags: ['Identidad corregida por el propietario; confirmar precio, condición y estado funcional.'],
});

Object.assign(productByItem.get(333), {
  title: 'Vaso térmico Rubbermaid de 500 mL',
  slug: 'vaso-termico-rubbermaid-de-500-ml-item-333',
  description: 'Vaso térmico Rubbermaid reutilizable de 500 mL con tapa.',
});
reviewByItem.get(333).dimensions = '19 cm de alto';
reviewByItem.get(356).dimensions = '36 × 36 cm';

const target336 = productByItem.get(336);
const target382 = productByItem.get(382);
const review336 = reviewByItem.get(336);
const review382 = reviewByItem.get(382);

async function createPublicDerivative(sourceFile, targetName, rotation = 0) {
  const sourcePath = path.join(sourceFile.startsWith('v4-ref-') ? referenceDir : imageDir, sourceFile);
  const targetPath = path.join(imageDir, targetName);
  try {
    await stat(targetPath);
  } catch {
    let image = sharp(sourcePath, { failOn: 'error' });
    if (rotation) image = image.rotate(rotation);
    await image.webp({ quality: 82 }).toFile(targetPath);
  }
  const [sourceMetadata, targetMetadata, sourceStats, targetStats] = await Promise.all([
    sharp(sourcePath).metadata(), sharp(targetPath).metadata(), stat(sourcePath), stat(targetPath),
  ]);
  return {
    originalWidth: sourceMetadata.width,
    originalHeight: sourceMetadata.height,
    originalOrientation: sourceMetadata.orientation || 1,
    originalBytes: sourceStats.size,
    optimizedFilename: targetName,
    optimizedWidth: targetMetadata.width,
    optimizedHeight: targetMetadata.height,
    optimizedBytes: targetStats.size,
    reductionPercent: Number((100 - (targetStats.size / sourceStats.size * 100)).toFixed(1)),
    publicPath: `/images/volume-4/${targetName}`,
    metadataStripped: true,
  };
}

const convertedReferenceRows = [];
for (const [review, product, prefix] of [[review336, target336, 'v4-g010-public-ref'], [review382, target382, 'v4-g056-public-ref']]) {
  for (const [index, referencePath] of review.referenceImages.entries()) {
    const sourceName = path.basename(referencePath);
    const targetName = `${prefix}-${String(index + 1).padStart(2, '0')}.webp`;
    const sourceReport = payload.referenceImages.find(row => row.optimizedFilename === sourceName);
    const row = await createPublicDerivative(sourceName, targetName);
    Object.assign(row, {
      groupId: review.groupId,
      originalFilename: sourceReport?.originalFilename || sourceName,
    });
    convertedReferenceRows.push(row);
    product.photos.push(row.publicPath);
  }
  review.referenceImages = [];
}

async function rotateGalleryPhoto(itemNumber, index, degrees, targetName) {
  const product = productByItem.get(itemNumber);
  if (!Number.isInteger(index) || !product.photos[index]) throw new Error(`No unambiguous selected image for Item ${itemNumber}.`);
  const oldPath = product.photos[index];
  const oldName = path.basename(oldPath);
  const row = await createPublicDerivative(oldName, targetName, degrees);
  const oldReport = payload.images.find(image => image.publicPath === oldPath);
  Object.assign(row, {
    groupId: review.groupId,
    originalFilename: oldReport?.originalFilename || oldName,
    derivedFrom: oldPath,
    rotationDegreesClockwise: degrees,
  });
  product.photos[index] = row.publicPath;
  const reportIndex = payload.images.findIndex(image => image.publicPath === oldPath);
  if (reportIndex < 0) throw new Error(`Image report missing ${oldPath}.`);
  payload.images[reportIndex] = row;
  return { oldPath, oldReport, row };
}

async function rotateAssignedPhoto(itemNumber, degrees, targetName) {
  return rotateGalleryPhoto(itemNumber, reviewByItem.get(itemNumber).coverIndex, degrees, targetName);
}

await rotateAssignedPhoto(379, 180, 'v4-g053-01-rotated-180.webp');
await rotateAssignedPhoto(430, 90, 'v4-g104-01-rotated-cw.webp');
const rotatedItem468 = await rotateGalleryPhoto(468, 2, -90, 'v4-g143-02-rotated-ccw.webp');
delete rotatedItem468.row.rotationDegreesClockwise;
rotatedItem468.row.rotationDegreesCounterclockwise = 90;
payload.preservedImageDerivatives = [
  ...(payload.preservedImageDerivatives || []).filter(entry => entry.publicPath !== rotatedItem468.oldPath),
  {
    ...rotatedItem468.oldReport,
    preservationReason: 'Original optimized derivative retained after the owner-authorized Item 468 photo 3 rotation.',
  },
];
payload.images.push(...convertedReferenceRows);
payload.referenceImages = payload.referenceImages.filter(row => row.groupId === '001');

function removeFlags(itemNumber, patterns) {
  const review = reviewByItem.get(itemNumber);
  review.flags = review.flags.filter(flag => !patterns.some(pattern => pattern.test(flag)));
}

for (const itemNumber of [341, 378, 405, 419, 422, 468]) {
  removeFlags(itemNumber, [/confirmar si/i, /no se fusionó/i, /modalidad de venta/i, /se vende como/i, /mismo producto/i]);
}
removeFlags(330, [/medid/i, /capacidad/i, /dimensions/i]);
removeFlags(333, [/capacidad/i, /altura/i, /medid/i]);
removeFlags(356, [/dimens/i, /medid/i]);
removeFlags(336, [/referenc/i, /fotos 346/i]);
removeFlags(382, [/referenc/i, /fotos 226/i, /fotos 227/i]);
removeFlags(435, [/reemplazar/i, /actualizar la imagen/i, /foto/i]);
reviewByItem.get(435).flags.push('El propietario añadirá otra imagen en una futura actualización de producción; no bloquea este lote.');
reviewByItem.get(423).flags.push('Producción: importar atómicamente con estado SOLD; nunca habilitar compra o reserva pública.');
productByItem.get(423).intendedPublicationStatus = 'SOLD';

productByItem.get(341).description = 'Juego de seis copas de vidrio transparente: cuatro iguales y dos iguales entre sí.';
productByItem.get(341).includedAccessories = ['4 identificadores para copas'];
productByItem.get(405).description = 'Frazada azul oscura y afelpada para cama matrimonial.';
reviewByItem.get(405).dimensions = '';
productByItem.get(357).description = 'Surtido de utensilios manuales de cocina: prensa para ajo OXO, exprimidor de cítricos, termómetro para carnes, cortador, 2 bombillas para tereré, medidor de pasta, deshojador de hierbas, pincel para marinada y pieza de acero inoxidable para quitar olores de las manos.';
productByItem.get(358).description = 'Conjunto de utensilios pequeños para preparación y servicio de alimentos: brochetas metálicas y de madera, etiquetas o identificadores para alimentos, palillos para aperitivos, cortador de queso tipo pala, cortador de queso con alambre y palitos para repostería.';
productByItem.get(402).description = 'Barra extensible de 4 m para accesorios de limpieza de piscina. El collarín plástico de bloqueo ajusta firmemente y el extremo tiene orificios dobles de conexión rápida compatibles con accesorios estándar.';
productByItem.get(386).description = productByItem.get(386).description.replace('Hermetico', 'Hermético');
productByItem.get(387).description = productByItem.get(387).description.replace('Mas de', 'Más de');
productByItem.get(392).description = productByItem.get(392).description.replace('aun', 'aún').replace('approximadamente', 'aproximadamente');
productByItem.get(408).title = productByItem.get(408).title.replace('azúl', 'azul');
productByItem.get(408).description = productByItem.get(408).description.replace('azúl', 'azul');
productByItem.get(421).description = productByItem.get(421).description.replace('Sold separately', 'Se venden por separado.');
productByItem.get(426).description = productByItem.get(426).description.replace(' mas ', ' más ');
productByItem.get(443).description = 'Conjunto de 2 sábanas celestes (1 ajustable y 1 plana) y 2 fundas para almohada.';
productByItem.get(460).description = productByItem.get(460).description.replace('sujetadores tipo binder', 'sujetadores tipo pinza');
productByItem.get(463).description = productByItem.get(463).description.replace(' mas ', ' más ');
productByItem.get(470).description = productByItem.get(470).description.replace('pretectadores', 'protectores');
productByItem.get(483).description = productByItem.get(483).description.replace('no esta incluido', 'no está incluida.');
productByItem.get(502).title = productByItem.get(502).title.replace('acrilico', 'acrílico');
productByItem.get(502).description = productByItem.get(502).description.replace('acrilico', 'acrílico');
reviewByItem.get(404).dimensions = '204 × 70 × 32–42 cm (alto × ancho × profundidad); base: 83 cm de alto; sección media: 50 cm de alto; sección superior: 67 cm de alto';
reviewByItem.get(411).dimensions = '48 × 29 × 18 cm (largo × ancho × profundidad)';
reviewByItem.get(454).dimensions = '48 × 29 × 18 cm (largo × ancho × profundidad)';
reviewByItem.get(456).dimensions = '33 × 24 cm (largo × alto)';
reviewByItem.get(497).dimensions = '25 × 17 × 23,8 cm (23,8 cm de alto)';

for (const [itemNumber, product] of productByItem) {
  const review = reviewByItem.get(itemNumber);
  const price = product.asking;
  review.flags = unique(review.flags.filter(flag => {
    if (price !== null && /price: missing|precio de venta.*confirmar|confirmar el precio/i.test(flag)) return false;
    if (product.condition && /condition: needs review|confirmar condición/i.test(flag)) return false;
    if (review.functionality && /functionality: unknown|funcionalidad.*ambigua/i.test(flag)) return false;
    if (review.dimensions && /dimensions: missing|falta medir|confirmar medidas/i.test(flag)) return false;
    return true;
  }));
}

Object.assign(productByItem.get(389), {
  asking: 20_000,
  condition: 'Estado regular',
  knownDefects: 'Ninguno conocido',
});
Object.assign(reviewByItem.get(389), {
  functionality: 'Funciona bien',
  currentSellerAskingPrice: 20_000,
  originalPriceReference: 'Precio confirmado por el propietario: Gs. 20.000.',
  suggestedAskingPrice: null,
  fastSalePrice: null,
  pricingComment: 'Precio de venta confirmado por el propietario; reemplaza la propuesta anterior.',
  pricingConfidence: 'Owner-confirmed',
  pricingSources: [],
  flags: ['Identidad, categoría, precio, condición, funcionalidad y defectos confirmados por el propietario; mantener revisión final por el cambio material de identidad.'],
});

const removedBeforePublication = [442, 509].map(itemNumber => {
  const product = productByItem.get(itemNumber);
  const review = reviewByItem.get(itemNumber);
  const imageReports = payload.images.filter(image => product.photos.includes(image.publicPath));
  productByItem.delete(itemNumber);
  reviewByItem.delete(itemNumber);
  return {
    itemNumber,
    disposition: 'REMOVED_BEFORE_PUBLICATION',
    reason: 'Owner confirmed this product is no longer part of the sale.',
    retiredPermanently: true,
    publicAvailabilityAllowed: false,
    product,
    review,
    imageReports,
    originalSourcePhotos: [...review.sourcePhotos],
    optimizedPhotosPreserved: [...product.photos],
  };
});
const removedPhotoPaths = new Set(removedBeforePublication.flatMap(entry => entry.product.photos));
payload.images = payload.images.filter(image => !removedPhotoPaths.has(image.publicPath));
payload.retiredInventory = removedBeforePublication;

const activeProducts = [...productByItem.values()].sort((a, b) => a.itemNumber - b.itemNumber);
const activeReviews = [...reviewByItem.values()].sort((a, b) => a.itemNumber - b.itemNumber);
if (activeProducts.length !== 175 || activeReviews.length !== 175) throw new Error('Final active product count is not 175.');

const retiredIds = [342, 420, 437, 442, 444, 469, 507, 509];
const statuses = { ...preserved.statuses };
const edits = { ...preserved.edits };
for (const itemNumber of retiredIds) {
  delete statuses[itemNumber];
  delete edits[itemNumber];
}
const rereviewItems = [336, 341, 378, 379, 382, 389, 405, 419, 422, 423, 430];
for (const itemNumber of rereviewItems) statuses[itemNumber] = 're-review';
for (const itemNumber of [330, 333, 356, 435, 468]) statuses[itemNumber] = 'approved';

for (const product of activeProducts) {
  const review = reviewByItem.get(product.itemNumber);
  edits[product.itemNumber] = {
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
  if (!statuses[product.itemNumber]) throw new Error(`Owner status missing for active Item ${product.itemNumber}.`);
}

const finalOwnerReviewState = {
  schemaVersion: 3,
  derivedFrom: 'owner-review-state.json',
  preservedSourceSha256: '83DDA8CF36C553B2526AF6F10703D820AAC4C70E7A11BDCA35D11CE92322FB08',
  storageKeys: {
    edits: 'psych-volume4-final-review-edits-v3',
    statuses: 'psych-volume4-final-review-status-v3',
  },
  editCount: Object.keys(edits).length,
  statusCount: Object.keys(statuses).length,
  latestOwnerDecision: 'Item 468 photo 3 rotated 90 degrees counterclockwise with its original preserved; owner explicitly authorized automatic approval for Item 468 only.',
  edits,
  statuses,
};
if (finalOwnerReviewState.editCount !== 175 || finalOwnerReviewState.statusCount !== 175) throw new Error('Final owner review state does not cover all 175 active products.');

payload.generatedAt = new Date().toISOString();
payload.currency = 'PYG';
payload.products = activeProducts;
payload.reviews = activeReviews;
payload.ownerReviewState = finalOwnerReviewState;
payload.retiredItemIds = retiredIds;
payload.productionHandoff = {
  currency: 'PYG',
  item133: {
    action: 'UPDATE_EXISTING_PRODUCT',
    titleRequirement: 'Identificar la marca Rubbermaid en el título y la descripción.',
    preserve: ['itemNumber', 'price', 'condition', 'quantity', 'photos', 'sale structure'],
  },
  item423: {
    action: 'IMPORT_AS_SOLD_ATOMICALLY',
    requiredStatus: 'SOLD',
    publicAvailabilityAllowed: false,
  },
  retiredBeforePublication: [442, 509].map(itemNumber => ({
    itemNumber,
    action: 'EXCLUDE_FROM_IMPORT',
    retiredPermanently: true,
    publicAvailabilityAllowed: false,
  })),
};
payload.statusAudit = {
  approvedCount: Object.values(statuses).filter(status => status === 'approved').length,
  reReviewCount: rereviewItems.length,
  missingCount: Object.values(statuses).filter(status => status === 'missing').length,
  reReviewReasons: {
    336: 'Public gallery materially expanded from four to eight owner-supplied photos; cover and gallery require final visual confirmation.',
    341: 'Item 342 photo was consolidated into Item 341, producing a three-photo gallery.',
    378: 'Item 507 photo was consolidated into Item 378, restoring the two-photo assortment.',
    379: 'Selected cover received a non-destructive 180-degree rotation.',
    382: 'Two formerly hidden product photos were restored to the six-photo public gallery.',
    389: 'Identity, category, PYG 20,000 price, condition, functionality, and defects are owner-confirmed; final spot-check remains required because the product identity and public copy were materially replaced.',
    405: 'Two Item 444 photos were consolidated into Item 405 and the public description was corrected.',
    419: 'Item 420 photo was consolidated into Item 419, producing a three-photo gallery.',
    422: 'Item 437 photo was consolidated into Item 422, producing a four-photo gallery.',
    423: 'Production handoff was materially changed to require atomic SOLD import with no public purchase window.',
    430: 'The sole product photo received a non-destructive 90-degree clockwise rotation.',
  },
  ownerAuthorizedApprovals: {
    468: 'Owner authorized automatic approval after rotating public gallery photo 3 90 degrees counterclockwise.',
  },
  restoredApprovals: [357, 358, 402, 421, 443, 460],
};
payload.unresolved = {
  ...payload.unresolved,
  sellerFacts: (payload.unresolved.sellerFacts || []).filter(entry => entry.itemNumber !== 389),
  missingPrices: activeProducts.filter(product => product.asking === null).map(product => product.itemNumber),
  missingMeasurements: (payload.unresolved.missingMeasurements || []).filter(itemNumber => itemNumber !== 389),
  missingCondition: (payload.unresolved.missingCondition || []).filter(itemNumber => itemNumber !== 389),
  unresolvedDefects: (payload.unresolved.unresolvedDefects || []).filter(itemNumber => itemNumber !== 389),
  unresolvedFunctionality: (payload.unresolved.unresolvedFunctionality || []).filter(itemNumber => itemNumber !== 389),
  ownerSpotCheck: rereviewItems,
  retiredItemIds: retiredIds,
  ownerQuestions: [],
};
const existingProducts = await loadExistingProducts(root);
payload.validation = await validateCatalog({ root, existingProducts, pilotProducts: activeProducts, intakeReport: payload.images });
payload.validation.allNeedsReview = activeProducts.every(product => product.status === 'NEEDS_REVIEW' && product.needsReview === true);
payload.validation.publicProjection = activeProducts.filter(product => product.status !== 'NEEDS_REVIEW' && product.status !== 'UNLISTED').length;
payload.validation.onlyAuthorizedReferenceImagesRemain = payload.referenceImages.length === 3 && activeReviews.every(review => review.itemNumber === 327 || review.referenceImages.length === 0);
payload.validation.ownerReviewStateCoverage = Object.keys(statuses).length === activeProducts.length && Object.keys(edits).length === activeProducts.length;
payload.validation.retiredIdsAbsent = retiredIds.every(itemNumber => !productByItem.has(itemNumber));
payload.validation.retiredPhotosPreserved = removedBeforePublication.every(entry => entry.optimizedPhotosPreserved.length === entry.product.photos.length);
payload.validation.ownerConfirmedItem389 = productByItem.get(389).asking === 20_000
  && productByItem.get(389).condition === 'Estado regular'
  && productByItem.get(389).knownDefects === 'Ninguno conocido'
  && reviewByItem.get(389).currentSellerAskingPrice === 20_000
  && reviewByItem.get(389).functionality === 'Funciona bien';
payload.validation.item468Photo3RotatedCounterclockwise = productByItem.get(468).photos[2] === rotatedItem468.row.publicPath
  && rotatedItem468.row.rotationDegreesCounterclockwise === 90;
payload.validation.item468OriginalPreserved = (await stat(path.join(root, rotatedItem468.oldPath.replace(/^\//, '').replaceAll('/', path.sep)))).size > 0;
payload.validation.item468FullGalleryPreserved = productByItem.get(468).photos.length === 4
  && reviewByItem.get(468).sourcePhotos.length === 4;

await writeBatchModule(batchPath, activeProducts);
await writeFile(finalStatePath, JSON.stringify(finalOwnerReviewState, null, 2), 'utf8');
await writeFile(path.join(root, 'volume4/production-handoff.json'), JSON.stringify(payload.productionHandoff, null, 2), 'utf8');
await writeFile(reportPath, JSON.stringify(payload, null, 2), 'utf8');
await writeReports(reportDir, payload);

process.stdout.write(`${JSON.stringify({
  ok: true,
  products: activeProducts.length,
  retiredIds,
  rereviewItems,
  statusCounts: Object.values(statuses).reduce((counts, status) => ({ ...counts, [status]: (counts[status] || 0) + 1 }), {}),
  validation: payload.validation,
}, null, 2)}\n`);
