import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  loadExistingProducts, validateCatalog, writeBatchModule, writeReports,
} from './workflow.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const reportDir = path.join(root, 'volume4/review-output');
const reportPath = path.join(reportDir, 'real-intake-report.json');
const statePath = path.join(reportDir, 'final-owner-review-state.json');
const batchPath = path.join(root, 'source/lib/volume4-batch.mjs');

const payload = JSON.parse(await readFile(reportPath, 'utf8'));
const ownerState = JSON.parse(await readFile(statePath, 'utf8'));

if (payload.products.length !== 175 || payload.reviews.length !== 175) {
  throw new Error('Expected the current 175-product final review state.');
}
if (ownerState.editCount !== 175 || ownerState.statusCount !== 175) {
  throw new Error('Expected complete owner-review coverage for 175 products.');
}
if (ownerState.statuses[389] !== 're-review') {
  throw new Error('Item 389 must remain in Revisar de nuevo for its final owner spot-check.');
}

const product = payload.products.find(candidate => candidate.itemNumber === 389);
const review = payload.reviews.find(candidate => candidate.itemNumber === 389);
if (!product || !review) throw new Error('Active Item 389 was not found.');

Object.assign(product, {
  title: 'Sierra para metales',
  slug: 'sierra-para-metales-item-389',
  category: 'Herramientas',
  description: 'Sierra manual con arco metálico y mango plástico para cortar metales.',
  asking: 20_000,
  condition: 'Estado regular',
  knownDefects: 'Ninguno conocido',
});

Object.assign(review, {
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

ownerState.edits[389] = {
  ...ownerState.edits[389],
  title: product.title,
  category: product.category,
  price: product.asking,
  description: product.description,
  condition: product.condition,
  defects: product.knownDefects,
  functionality: review.functionality,
};
ownerState.latestOwnerDecision = 'Items 442 and 509 removed before publication; Item 389 identity, category, PYG 20,000 price, condition, functionality, and defects confirmed by the owner.';

const reReviewItems = Object.entries(ownerState.statuses)
  .filter(([, status]) => status === 're-review')
  .map(([itemNumber]) => Number(itemNumber));
const approvedCount = Object.values(ownerState.statuses).filter(status => status === 'approved').length;
const missingCount = Object.values(ownerState.statuses).filter(status => status === 'missing').length;
if (approvedCount !== 163 || reReviewItems.length !== 12 || missingCount !== 0) {
  throw new Error(`Unexpected review counts: ${approvedCount} approved, ${reReviewItems.length} re-review, ${missingCount} missing.`);
}
if (!reReviewItems.includes(389)) throw new Error('Item 389 was removed from the final spot-check list.');

payload.generatedAt = new Date().toISOString();
payload.ownerReviewState = ownerState;
payload.statusAudit = {
  ...payload.statusAudit,
  approvedCount,
  reReviewCount: reReviewItems.length,
  missingCount,
  reReviewReasons: {
    ...payload.statusAudit.reReviewReasons,
    389: 'Identity, category, PYG 20,000 price, condition, functionality, and defects are owner-confirmed; final spot-check remains required because the product identity and public copy were materially replaced.',
  },
};

payload.unresolved = {
  ...payload.unresolved,
  sellerFacts: (payload.unresolved.sellerFacts || []).filter(entry => entry.itemNumber !== 389),
  missingMeasurements: (payload.unresolved.missingMeasurements || []).filter(itemNumber => itemNumber !== 389),
  missingCondition: (payload.unresolved.missingCondition || []).filter(itemNumber => itemNumber !== 389),
  unresolvedDefects: (payload.unresolved.unresolvedDefects || []).filter(itemNumber => itemNumber !== 389),
  unresolvedFunctionality: (payload.unresolved.unresolvedFunctionality || []).filter(itemNumber => itemNumber !== 389),
  ownerSpotCheck: reReviewItems,
  ownerQuestions: [],
};

const existingProducts = await loadExistingProducts(root);
payload.validation = await validateCatalog({
  root,
  existingProducts,
  pilotProducts: payload.products,
  intakeReport: payload.images,
});
payload.validation.allNeedsReview = payload.products.every(candidate => candidate.status === 'NEEDS_REVIEW' && candidate.needsReview === true);
payload.validation.publicProjection = payload.products.filter(candidate => !['NEEDS_REVIEW', 'UNLISTED'].includes(candidate.status)).length;
payload.validation.onlyAuthorizedReferenceImagesRemain = payload.referenceImages.length === 3
  && payload.reviews.every(candidate => candidate.itemNumber === 327 || candidate.referenceImages.length === 0);
payload.validation.ownerReviewStateCoverage = ownerState.editCount === payload.products.length
  && ownerState.statusCount === payload.products.length;
payload.validation.retiredIdsAbsent = payload.retiredItemIds.every(itemNumber => !payload.products.some(candidate => candidate.itemNumber === itemNumber));
payload.validation.retiredPhotosPreserved = (payload.retiredInventory || []).every(entry => entry.optimizedPhotosPreserved.length === entry.product.photos.length);
payload.validation.ownerConfirmedItem389 = product.asking === 20_000
  && product.condition === 'Estado regular'
  && product.knownDefects === 'Ninguno conocido'
  && review.currentSellerAskingPrice === 20_000
  && review.functionality === 'Funciona bien';
payload.validation.zeroOutstandingOwnerQuestions = payload.unresolved.ownerQuestions.length === 0;
payload.validation.reviewCountsPreserved = approvedCount === 163 && reReviewItems.length === 12 && missingCount === 0;

if (!payload.validation.allNeedsReview || payload.validation.publicProjection !== 0) {
  throw new Error('NEEDS_REVIEW/public projection safety check failed.');
}
if (!payload.validation.ownerConfirmedItem389 || !payload.validation.zeroOutstandingOwnerQuestions) {
  throw new Error('Item 389 owner confirmation was not applied completely.');
}

await writeBatchModule(batchPath, payload.products);
await writeFile(statePath, JSON.stringify(ownerState, null, 2), 'utf8');
await writeFile(reportPath, JSON.stringify(payload, null, 2), 'utf8');
await writeReports(reportDir, payload);

process.stdout.write(`${JSON.stringify({
  ok: true,
  item389: {
    title: product.title,
    category: product.category,
    asking: product.asking,
    condition: product.condition,
    functionality: review.functionality,
    knownDefects: product.knownDefects,
    status: ownerState.statuses[389],
  },
  activeProductCount: payload.products.length,
  approvedCount,
  reReviewItems,
  missingCount,
  ownerQuestions: payload.unresolved.ownerQuestions,
  validation: payload.validation,
}, null, 2)}\n`);
