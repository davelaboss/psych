import path from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import {
  loadExistingProducts, validateCatalog, writeBatchModule, writeReports,
} from './workflow.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const reportDir = path.join(root, 'volume4/review-output');
const reportPath = path.join(reportDir, 'real-intake-report.json');
const statePath = path.join(reportDir, 'final-owner-review-state.json');
const batchPath = path.join(root, 'source/lib/volume4-batch.mjs');
const handoffPath = path.join(root, 'volume4/production-handoff.json');

const payload = JSON.parse(await readFile(reportPath, 'utf8'));
const ownerState = JSON.parse(await readFile(statePath, 'utf8'));
if (payload.products.length !== 177) throw new Error(`Expected the corrected 177-product state, found ${payload.products.length}.`);
if (ownerState.statusCount !== 177 || ownerState.editCount !== 177) throw new Error('Expected complete owner-review coverage for 177 products.');

const productByItem = new Map(payload.products.map(product => [product.itemNumber, product]));
const reviewByItem = new Map(payload.reviews.map(review => [review.itemNumber, review]));
for (const itemNumber of [389, 442, 509]) {
  if (!productByItem.has(itemNumber) || !reviewByItem.has(itemNumber)) throw new Error(`Expected active Item ${itemNumber}.`);
}

const item389 = productByItem.get(389);
const review389 = reviewByItem.get(389);
Object.assign(item389, {
  title: 'Sierra para metales',
  slug: 'sierra-para-metales-item-389',
  category: 'Herramientas',
  asking: 20_000,
  condition: 'Estado regular',
  knownDefects: 'Ninguno conocido',
});
Object.assign(review389, {
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

const removedItems = [];
for (const itemNumber of [442, 509]) {
  const product = productByItem.get(itemNumber);
  const review = reviewByItem.get(itemNumber);
  const imageReports = payload.images.filter(image => product.photos.includes(image.publicPath));
  for (const publicPath of product.photos) {
    const diskPath = path.join(root, publicPath.replace(/^\//, '').replaceAll('/', path.sep));
    await stat(diskPath);
  }
  removedItems.push({
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
  });
}

const removedPhotoPaths = new Set(removedItems.flatMap(entry => entry.product.photos));
payload.images = payload.images.filter(image => !removedPhotoPaths.has(image.publicPath));
payload.products = payload.products.filter(product => ![442, 509].includes(product.itemNumber));
payload.reviews = payload.reviews.filter(review => ![442, 509].includes(review.itemNumber));
payload.retiredInventory = [
  ...(payload.retiredInventory || []).filter(entry => ![442, 509].includes(entry.itemNumber)),
  ...removedItems,
];

for (const itemNumber of [442, 509]) {
  delete ownerState.edits[itemNumber];
  delete ownerState.statuses[itemNumber];
}
ownerState.edits[389] = {
  ...ownerState.edits[389],
  title: item389.title,
  category: item389.category,
  price: item389.asking,
  description: item389.description,
  condition: item389.condition,
  defects: item389.knownDefects,
  functionality: review389.functionality,
};

const copyOnlyItems = [357, 358, 402, 421, 443, 460];
for (const itemNumber of copyOnlyItems) ownerState.statuses[itemNumber] = 'approved';
ownerState.statuses[389] = 're-review';
ownerState.statuses[468] = 'approved';
ownerState.schemaVersion = 3;
ownerState.storageKeys = {
  edits: 'psych-volume4-final-review-edits-v3',
  statuses: 'psych-volume4-final-review-status-v3',
};
ownerState.editCount = Object.keys(ownerState.edits).length;
ownerState.statusCount = Object.keys(ownerState.statuses).length;
ownerState.latestOwnerDecision = 'Item 468 photo 3 rotated 90 degrees counterclockwise with its original preserved; owner explicitly authorized automatic approval for Item 468 only.';
if (ownerState.editCount !== 175 || ownerState.statusCount !== 175) throw new Error('Final owner state does not cover exactly 175 active products.');

const reReviewReasons = {
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
};
const reReviewItems = Object.entries(ownerState.statuses)
  .filter(([, status]) => status === 're-review')
  .map(([itemNumber]) => Number(itemNumber));
if (JSON.stringify(reReviewItems) !== JSON.stringify(Object.keys(reReviewReasons).map(Number))) {
  throw new Error(`Unexpected re-review list: ${reReviewItems.join(', ')}`);
}

payload.generatedAt = new Date().toISOString();
payload.currency = 'PYG';
payload.ownerReviewState = ownerState;
payload.retiredItemIds = [342, 420, 437, 442, 444, 469, 507, 509];
payload.statusAudit = {
  approvedCount: Object.values(ownerState.statuses).filter(status => status === 'approved').length,
  reReviewCount: reReviewItems.length,
  missingCount: Object.values(ownerState.statuses).filter(status => status === 'missing').length,
  reReviewReasons,
  ownerAuthorizedApprovals: {
    468: 'Owner authorized automatic approval after rotating public gallery photo 3 90 degrees counterclockwise.',
  },
  restoredApprovals: {
    357: 'Owner-approved mixed-language copy translated to Spanish; facts unchanged.',
    358: 'Owner-approved English item names translated to Spanish; facts unchanged.',
    402: 'Owner-approved English feature sentences translated to Spanish; facts unchanged.',
    421: '“Sold separately” translated to “Se venden por separado”; sale structure unchanged.',
    443: '“Fitted” and “flat” translated to “ajustable” and “plana”; contents unchanged.',
    460: '“Binder” translated to “pinza”; contents unchanged.',
  },
};
payload.productionHandoff = {
  ...payload.productionHandoff,
  currency: 'PYG',
  retiredBeforePublication: [442, 509].map(itemNumber => ({
    itemNumber,
    action: 'EXCLUDE_FROM_IMPORT',
    retiredPermanently: true,
    publicAvailabilityAllowed: false,
  })),
};
payload.unresolved = {
  ...payload.unresolved,
  sellerFacts: (payload.unresolved.sellerFacts || []).filter(entry => entry.itemNumber !== 389),
  missingPrices: payload.products.filter(product => product.asking === null).map(product => product.itemNumber),
  missingMeasurements: (payload.unresolved.missingMeasurements || []).filter(itemNumber => itemNumber !== 389),
  missingCondition: (payload.unresolved.missingCondition || []).filter(itemNumber => itemNumber !== 389),
  unresolvedDefects: (payload.unresolved.unresolvedDefects || []).filter(itemNumber => itemNumber !== 389),
  unresolvedFunctionality: (payload.unresolved.unresolvedFunctionality || []).filter(itemNumber => itemNumber !== 389),
  ownerSpotCheck: reReviewItems,
  retiredItemIds: payload.retiredItemIds,
  ownerQuestions: [],
};

if (payload.products.length !== 175 || payload.reviews.length !== 175) throw new Error('Expected 175 active products and reviews.');
const activeIds = new Set(payload.products.map(product => product.itemNumber));
if (payload.retiredItemIds.some(itemNumber => activeIds.has(itemNumber))) throw new Error('A retired Item ID remains active.');
if (Math.max(...activeIds) !== 508) throw new Error('Unexpected new product ID after retiring Item 509.');

const existingProducts = await loadExistingProducts(root);
payload.validation = await validateCatalog({ root, existingProducts, pilotProducts: payload.products, intakeReport: payload.images });
payload.validation.allNeedsReview = payload.products.every(product => product.status === 'NEEDS_REVIEW' && product.needsReview === true);
payload.validation.publicProjection = payload.products.filter(product => !['NEEDS_REVIEW', 'UNLISTED'].includes(product.status)).length;
payload.validation.onlyAuthorizedReferenceImagesRemain = payload.referenceImages.length === 3
  && payload.reviews.every(review => review.itemNumber === 327 || review.referenceImages.length === 0);
payload.validation.ownerReviewStateCoverage = ownerState.editCount === payload.products.length && ownerState.statusCount === payload.products.length;
payload.validation.retiredIdsAbsent = payload.retiredItemIds.every(itemNumber => !activeIds.has(itemNumber));
payload.validation.retiredPhotosPreserved = removedItems.every(entry => entry.optimizedPhotosPreserved.length === entry.product.photos.length);
payload.validation.ownerConfirmedItem389 = item389.asking === 20_000
  && item389.condition === 'Estado regular'
  && item389.knownDefects === 'Ninguno conocido'
  && review389.currentSellerAskingPrice === 20_000
  && review389.functionality === 'Funciona bien';

await writeBatchModule(batchPath, payload.products);
await writeFile(statePath, JSON.stringify(ownerState, null, 2), 'utf8');
await writeFile(handoffPath, JSON.stringify(payload.productionHandoff, null, 2), 'utf8');
await writeFile(reportPath, JSON.stringify(payload, null, 2), 'utf8');
await writeReports(reportDir, payload);

process.stdout.write(`${JSON.stringify({
  ok: true,
  products: payload.products.length,
  retiredIds: payload.retiredItemIds,
  reReviewItems,
  statusAudit: payload.statusAudit,
  validation: payload.validation,
}, null, 2)}\n`);
