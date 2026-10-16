import path from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
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
if (ownerState.statuses[468] !== 're-review') {
  throw new Error('Expected Item 468 to be awaiting re-review before the authorized auto-approval.');
}

const statusesBefore = structuredClone(ownerState.statuses);
const product = payload.products.find(candidate => candidate.itemNumber === 468);
const review = payload.reviews.find(candidate => candidate.itemNumber === 468);
if (!product || !review) throw new Error('Active Item 468 was not found.');
if (product.photos.length !== 4 || review.sourcePhotos.length !== 4) {
  throw new Error('Item 468 no longer contains the expected four consolidated photos.');
}
const expectedSourcePhotos = [
  'Vol 4 pic 279.JPG',
  'Vol 4 pic 280.JPG',
  'Vol 4 pic 281.JPG',
  'Vol 4 pic 282.JPG',
];
if (JSON.stringify(review.sourcePhotos) !== JSON.stringify(expectedSourcePhotos)) {
  throw new Error('Item 468 source-photo lineage no longer matches the Item 468 + Item 469 consolidation.');
}

const sourcePublicPath = '/images/volume-4/v4-g143-02.webp';
const correctedPublicPath = '/images/volume-4/v4-g143-02-rotated-ccw.webp';
if (product.photos[2] !== sourcePublicPath) {
  throw new Error(`Unexpected Item 468 photo 3: ${product.photos[2]}`);
}
const sourcePath = path.join(root, sourcePublicPath.replace(/^\//, '').replaceAll('/', path.sep));
const correctedPath = path.join(root, correctedPublicPath.replace(/^\//, '').replaceAll('/', path.sep));
const [sourceMetadata, sourceStats] = await Promise.all([sharp(sourcePath).metadata(), stat(sourcePath)]);

try {
  await stat(correctedPath);
} catch {
  await sharp(sourcePath).rotate(-90).webp({ quality: 82 }).toFile(correctedPath);
}
const [correctedMetadata, correctedStats] = await Promise.all([sharp(correctedPath).metadata(), stat(correctedPath)]);
if (correctedMetadata.width !== sourceMetadata.height || correctedMetadata.height !== sourceMetadata.width) {
  throw new Error('The Item 468 corrected derivative does not have the expected counterclockwise-rotation dimensions.');
}

const reportIndex = payload.images.findIndex(image => image.publicPath === sourcePublicPath);
if (reportIndex < 0) throw new Error('The source image report for Item 468 photo 3 is missing.');
const sourceReport = payload.images[reportIndex];
payload.images[reportIndex] = {
  ...sourceReport,
  optimizedFilename: path.basename(correctedPath),
  optimizedWidth: correctedMetadata.width,
  optimizedHeight: correctedMetadata.height,
  optimizedBytes: correctedStats.size,
  reductionPercent: Number((100 - (correctedStats.size / sourceReport.originalBytes * 100)).toFixed(1)),
  publicPath: correctedPublicPath,
  derivedFrom: sourcePublicPath,
  rotationDegreesCounterclockwise: 90,
};
payload.preservedImageDerivatives = [
  ...(payload.preservedImageDerivatives || []).filter(entry => entry.publicPath !== sourcePublicPath),
  {
    ...sourceReport,
    bytesOnDisk: sourceStats.size,
    preservationReason: 'Original optimized derivative retained after the owner-authorized Item 468 photo 3 rotation.',
  },
];
product.photos[2] = correctedPublicPath;

ownerState.statuses[468] = 'approved';
ownerState.latestOwnerDecision = 'Item 468 photo 3 rotated 90 degrees counterclockwise with its original preserved; owner explicitly authorized automatic approval for Item 468 only.';
const changedStatuses = Object.keys(ownerState.statuses).filter(itemNumber => ownerState.statuses[itemNumber] !== statusesBefore[itemNumber]);
if (JSON.stringify(changedStatuses) !== JSON.stringify(['468'])) {
  throw new Error(`Unexpected status changes: ${changedStatuses.join(', ')}`);
}

const reReviewItems = Object.entries(ownerState.statuses)
  .filter(([, status]) => status === 're-review')
  .map(([itemNumber]) => Number(itemNumber));
const approvedCount = Object.values(ownerState.statuses).filter(status => status === 'approved').length;
const missingCount = Object.values(ownerState.statuses).filter(status => status === 'missing').length;
if (approvedCount !== 164 || reReviewItems.length !== 11 || missingCount !== 0 || reReviewItems.includes(468)) {
  throw new Error(`Unexpected review counts after Item 468 approval: ${approvedCount} approved, ${reReviewItems.length} re-review, ${missingCount} missing.`);
}

const { 468: removedReason, ...remainingReasons } = payload.statusAudit.reReviewReasons;
if (!removedReason) throw new Error('Item 468 did not have the expected re-review reason.');
payload.generatedAt = new Date().toISOString();
payload.ownerReviewState = ownerState;
payload.statusAudit = {
  ...payload.statusAudit,
  approvedCount,
  reReviewCount: reReviewItems.length,
  missingCount,
  reReviewReasons: remainingReasons,
  ownerAuthorizedApprovals: {
    ...(payload.statusAudit.ownerAuthorizedApprovals || {}),
    468: 'Owner authorized automatic approval after rotating public gallery photo 3 90 degrees counterclockwise.',
  },
};
payload.unresolved = {
  ...payload.unresolved,
  ownerSpotCheck: reReviewItems,
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
payload.validation.item468Photo3RotatedCounterclockwise = product.photos[2] === correctedPublicPath
  && payload.images[reportIndex].rotationDegreesCounterclockwise === 90;
payload.validation.item468OriginalPreserved = sourceStats.size > 0 && (await stat(sourcePath)).size === sourceStats.size;
payload.validation.item468FullGalleryPreserved = product.photos.length === 4
  && review.sourcePhotos.length === 4
  && expectedSourcePhotos.every(source => review.sourcePhotos.includes(source));
payload.validation.onlyItem468StatusChanged = changedStatuses.length === 1 && changedStatuses[0] === '468';
payload.validation.reviewCountsAfterItem468Approval = approvedCount === 164 && reReviewItems.length === 11 && missingCount === 0;

if (!payload.validation.allNeedsReview || payload.validation.publicProjection !== 0) {
  throw new Error('NEEDS_REVIEW/public projection safety check failed.');
}
if (!payload.validation.item468Photo3RotatedCounterclockwise
  || !payload.validation.item468OriginalPreserved
  || !payload.validation.item468FullGalleryPreserved
  || !payload.validation.onlyItem468StatusChanged) {
  throw new Error('Item 468 final correction validation failed.');
}

await writeBatchModule(batchPath, payload.products, ownerState);
await writeFile(statePath, JSON.stringify(ownerState, null, 2), 'utf8');
await writeFile(reportPath, JSON.stringify(payload, null, 2), 'utf8');
await writeReports(reportDir, payload);

process.stdout.write(`${JSON.stringify({
  ok: true,
  item468: {
    photo3: product.photos[2],
    rotationDegreesCounterclockwise: 90,
    originalPreserved: payload.validation.item468OriginalPreserved,
    gallery: product.photos,
    sourcePhotos: review.sourcePhotos,
    status: ownerState.statuses[468],
  },
  activeProductCount: payload.products.length,
  approvedCount,
  reReviewItems,
  missingCount,
  changedStatuses,
  validation: payload.validation,
}, null, 2)}\n`);
