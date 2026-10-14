import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  promoteApprovedVolume4,
  writeBatchModule,
} from './workflow.mjs';

const root = path.resolve(process.argv[2] || process.cwd());
const batchPath = path.join(root, 'source/lib/volume4-batch.mjs');
const ownerState = JSON.parse(await readFile(
  path.join(root, 'volume4/review-output/final-owner-review-state.json'),
  'utf8'
));
const productionHandoff = JSON.parse(await readFile(
  path.join(root, 'volume4/production-handoff.json'),
  'utf8'
));
const batchUrl = `${pathToFileURL(batchPath).href}?publication=${Date.now()}`;
const { VOLUME4_ITEMS } = await import(batchUrl);
const publishedProducts = promoteApprovedVolume4(
  structuredClone(VOLUME4_ITEMS),
  ownerState,
  productionHandoff
);

await writeBatchModule(batchPath, publishedProducts, ownerState, { published: true });

process.stdout.write(`${JSON.stringify({
  ok: true,
  active: publishedProducts.length,
  available: publishedProducts.filter(product => product.status === 'AVAILABLE').length,
  sold: publishedProducts.filter(product => product.status === 'SOLD').length,
  needsReview: publishedProducts.filter(product => product.status === 'NEEDS_REVIEW').length,
  item423: publishedProducts.find(product => product.itemNumber === 423)?.status,
}, null, 2)}\n`);
