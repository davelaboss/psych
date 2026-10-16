import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  createDraft,
  loadExistingProducts,
  optimizeGroups,
  parseGroupedNotes,
  readSafetyBaseline,
  validateCatalog,
  writeBatchModule,
  writeReports,
} from './workflow.mjs';

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index].replace(/^--/, '')] = argv[index + 1];
  return values;
}

const options = args(process.argv.slice(2));
const root = path.resolve(options.root || process.cwd());
const intakeDir = path.resolve(options.intake || path.join(root, '..', 'volume4-pilot-intake'));
const notesFile = path.resolve(options.notes || path.join(root, 'pilot/volume4-pilot-notes.txt'));
const outputDir = path.resolve(options.images || path.join(root, 'images/volume-4-pilot'));
const batchFile = path.resolve(options.batch || path.join(root, 'source/lib/volume4-batch.mjs'));
const reportDir = path.resolve(options.reports || path.join(root, 'pilot/volume4-output'));
const productionUrl = options.production || 'https://thelabossieres.com';

const groups = parseGroupedNotes(await readFile(notesFile, 'utf8'));
const existingProducts = await loadExistingProducts(root);
const baseline = await readSafetyBaseline(root, productionUrl);
const committedMax = Math.max(...existingProducts.map(item => Number(item.itemNumber) || 0));
const startingItemNumber = Math.max(committedMax, baseline.productionMaxItemNumber) + 1;
const optimized = await optimizeGroups(groups, { intakeDir, outputDir });
const drafts = groups.map((group, index) => createDraft(group, startingItemNumber + index, optimized.photosByGroup.get(group.groupId)));
const products = drafts.map(draft => draft.product);
const reviews = drafts.map(draft => ({ itemNumber: draft.product.itemNumber, ...draft.review }));
await writeBatchModule(batchFile, products);
const validation = await validateCatalog({ root, existingProducts, pilotProducts: products, intakeReport: optimized.report });
const originalBytes = optimized.report.reduce((sum, image) => sum + image.originalBytes, 0);
const optimizedBytes = optimized.report.reduce((sum, image) => sum + image.optimizedBytes, 0);
const payload = {
  generatedAt: new Date().toISOString(), baseline, committedMax, startingItemNumber,
  products, reviews, images: optimized.report, validation,
  totals: { originalBytes, optimizedBytes, reductionPercent: Number(((1 - optimizedBytes / originalBytes) * 100).toFixed(1)) },
};
await writeReports(reportDir, payload);
process.stdout.write(`${JSON.stringify({ ok: true, ...payload.totals, products: products.length, photos: optimized.report.length, startingItemNumber, validation }, null, 2)}\n`);
