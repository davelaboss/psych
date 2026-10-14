import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import sharp from 'sharp';
import {
  createDraft, optimizeGroups, parseGroupedNotes, preserveReviewFields,
  promoteApprovedVolume4, reviewHtml,
} from './workflow.mjs';

test('batch projection preserves review dimensions and functionality exactly', () => {
  const products = [{ itemNumber: 333, title: 'Vaso térmico' }];
  const ownerReviewState = {
    edits: {
      333: {
        dimensions: '19 cm de alto',
        functionality: 'Funciona bien',
      },
    },
  };

  assert.deepEqual(preserveReviewFields(products, ownerReviewState), [{
    itemNumber: 333,
    title: 'Vaso térmico',
    measurements: '19 cm de alto',
    functionality: 'Funciona bien',
  }]);
  assert.equal(Object.hasOwn(products[0], 'measurements'), false);
});

test('publication promotion is gated by complete approval and makes Item 423 sold atomically', () => {
  const retiredIds = new Set([342, 420, 437, 442, 444, 469, 507, 509]);
  const itemNumbers = Array.from({ length: 182 }, (_, index) => 327 + index)
    .filter(itemNumber => !retiredIds.has(itemNumber));
  const products = itemNumbers.map(itemNumber => {
    return {
      itemNumber,
      title: `Item ${itemNumber}`,
      category: 'Hogar',
      asking: 10_000,
      description: `Item ${itemNumber}.`,
      condition: 'Buen estado',
      knownDefects: 'Ninguno conocido.',
      functionality: 'Funciona bien',
      measurements: '',
      quantityTotal: 1,
      saleMode: 'IMMEDIATE',
      includedAccessories: [],
      status: 'NEEDS_REVIEW',
      needsReview: true,
    };
  });
  const edits = Object.fromEntries(products.map(product => [product.itemNumber, {
    title: product.title,
    category: product.category,
    price: product.asking,
    description: product.description,
    condition: product.condition,
    defects: product.knownDefects,
    functionality: product.functionality,
    dimensions: product.measurements,
    quantity: product.quantityTotal,
    pickupMode: product.saleMode,
    includedAccessories: product.includedAccessories,
  }]));
  const statuses = Object.fromEntries(products.map(product => [product.itemNumber, 'approved']));
  const handoff = {
    item423: {
      action: 'IMPORT_AS_SOLD_ATOMICALLY',
      requiredStatus: 'SOLD',
      publicAvailabilityAllowed: false,
    },
  };

  const published = promoteApprovedVolume4(products, { edits, statuses }, handoff);
  assert.equal(published.filter(product => product.status === 'AVAILABLE').length, 174);
  assert.equal(published.find(product => product.itemNumber === 423).status, 'SOLD');
  assert.ok(published.every(product => product.needsReview === false));
  assert.ok(products.every(product => product.status === 'NEEDS_REVIEW'));

  statuses[327] = 're-review';
  assert.throws(
    () => promoteApprovedVolume4(products, { edits, statuses }, handoff),
    /all 175 products to be owner-approved/
  );
});

test('group parser supports multiple photos, labels, and ordinary free-form notes', () => {
  const groups = parseGroupedNotes(`GROUP 012\n\nPhotos:\na.jpg\nb.jpg\n\nName: Blender\nPrice: 120000\n\nNotes:\nWorks correctly.\nOrdinary free-form line.`);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].photos, ['a.jpg', 'b.jpg']);
  assert.equal(groups[0].fields.name, 'Blender');
  assert.deepEqual(groups[0].notes, ['Works correctly.', 'Ordinary free-form line.']);
});

test('draft generator withholds uncertain sentences and never emits provenance language', () => {
  const group = parseGroupedNotes(`GROUP 1\nPhotos:\na.jpg\nName: Test item\nPrice: 10000\nNotes:\nWorks correctly. Falta confirmar el modelo.`)[0];
  const { product, review } = createDraft(group, 327, ['/images/volume-4-pilot/a.webp']);
  assert.match(product.description, /Works correctly/);
  assert.doesNotMatch(product.description, /Falta confirmar/);
  assert.equal(product.status, 'NEEDS_REVIEW');
  assert.ok(review.flags.some(flag => flag.includes('withheld')));
});

test('a missing physical part remains a public defect rather than an uncertainty marker', () => {
  const group = parseGroupedNotes(`GROUP 1\nPhotos:\na.jpg\nName: Test item\nPrice: 10000\nDefects: Falta un apoyo de goma negro.\nNotes:\nSe vende por unidad.`)[0];
  const { product } = createDraft(group, 327, ['/images/volume-4-pilot/a.webp']);
  assert.equal(product.knownDefects, 'Falta un apoyo de goma negro.');
});

test('used-item normal wear defaults only when no specific defect is supplied', () => {
  const withoutDefect = parseGroupedNotes(`GROUP 1\nPhotos:\na.jpg\nName: Used item\nPrice: 10000`)[0];
  const withDefect = parseGroupedNotes(`GROUP 2\nPhotos:\nb.jpg\nName: Used item\nPrice: 10000\nDefects: Cable dañado.`)[0];
  assert.equal(createDraft(withoutDefect, 327, ['/a.webp']).product.knownDefects, 'Desgaste por uso normal.');
  assert.equal(createDraft(withDefect, 328, ['/b.webp']).product.knownDefects, 'Cable dañado.');
});

test('optimizer preserves aspect ratio, never enlarges, emits WebP, and refuses collisions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'psych-v4-'));
  const intake = path.join(root, 'intake');
  const output = path.join(root, 'output');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(intake));
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#884422' } }).jpeg().withMetadata({ orientation: 6 }).toFile(path.join(intake, 'photo.jpg'));
  const groups = [{ groupId: '001', photos: ['photo.jpg'], notes: [], fields: {} }];
  const first = await optimizeGroups(groups, { intakeDir: intake, outputDir: output });
  assert.equal(first.report[0].optimizedWidth, 800);
  assert.equal(first.report[0].optimizedHeight, 1200);
  assert.equal(first.report[0].metadataStripped, true);
  await assert.rejects(() => optimizeGroups(groups, { intakeDir: intake, outputDir: output }), /Refusing to overwrite/);
});

test('optimizer rejects unassigned intake photos', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'psych-v4-unassigned-'));
  await writeFile(path.join(root, 'assigned.jpg'), 'x');
  await writeFile(path.join(root, 'extra.jpg'), 'x');
  await assert.rejects(() => optimizeGroups([{ groupId: '1', photos: ['assigned.jpg'], notes: [], fields: {} }], {
    intakeDir: root, outputDir: path.join(root, 'output'),
  }), /not assigned/);
});

test('review page exposes complete detail fields, sequential navigation, and local-only editing', () => {
  const html = reviewHtml([{
    itemNumber: 329,
    title: 'Test stove',
    category: 'Electrodomésticos',
    asking: 750000,
    description: 'Five burner stove.',
    condition: '',
    knownDefects: 'Ignition issue.',
    quantityTotal: 1,
    saleMode: 'DELAYED',
    includedAccessories: ['Lighter'],
    photos: ['/images/volume-4-pilot/one.webp', '/images/volume-4-pilot/two.webp'],
  }], [{
    itemNumber: 329,
    groupId: '003',
    functionality: 'Works.',
    dimensions: '',
    currentSellerAskingPrice: 750000,
    suggestedAskingPrice: 650000,
    referenceImages: ['/images/volume-4-pilot/reference.webp'],
    flags: ['dimensions: unknown'],
  }], [], {
    storageKeys: {
      edits: 'test-volume4-owner-edits-v3',
      statuses: 'test-volume4-owner-statuses-v3',
    },
    edits: { 329: { title: 'Seeded owner title' } },
    statuses: { 329: 'approved' },
  });

  assert.match(html, /src="\.\.\/\.\.\/images\/volume-4-pilot\/two\.webp"/);
  for (const label of ['Item number', 'Title', 'Category', 'Price', 'Description', 'Condition', 'Defects', 'Functionality', 'Dimensions', 'Quantity', 'Pickup mode', 'Included accessories']) {
    assert.match(html, new RegExp(`'${label}'`));
  }
  assert.match(html, /id="previous-item"/);
  assert.match(html, /id="next-item"/);
  assert.match(html, /ArrowLeft/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /Edit draft/);
  assert.match(html, /id="edit-draft" class="edit-draft-button"/);
  assert.match(html, /id="edit-draft-secondary" class="edit-draft-button secondary-edit"/);
  assert.match(html, /querySelectorAll\('\.edit-draft-button'\)\.forEach\(button=>button\.onclick=showEdit\)/);
  assert.match(html, /\.detail-left-column,\.detail-right-column\{display:flex;flex-direction:column;gap:18px/);
  assert.match(html, /grid-template-areas:"details" "media" "pricing" "internal" "secondary-edit" "seller"/);
  assert.match(html, /\.detail-left-column,\.detail-right-column\{display:contents\}/);
  assert.match(html, /class="detail-left-column"[\s\S]*class="detail-media"[\s\S]*class="pricing-review"[\s\S]*class="detail-right-column"[\s\S]*class="field-list"[\s\S]*class="internal-review"[\s\S]*id="edit-draft-secondary"[\s\S]*class="seller-reference"/);
  assert.match(html, /<h3>Pricing assistance — internal only<\/h3>/);
  assert.match(html, /<h3>Internal review only<\/h3>/);
  assert.match(html, /<summary>Private seller reference<\/summary>/);
  assert.match(html, /localStorage/);
  assert.match(html, /test-volume4-owner-edits-v3/);
  assert.match(html, /test-volume4-owner-statuses-v3/);
  assert.match(html, /Seeded owner title/);
  assert.match(html, /does not update source files, admin, Blob, or production/);
  assert.match(html, /Nothing here is published automatically/);
  for (const status of ['Sin revisar', 'Falta información', 'Aprobado', 'Revisar de nuevo']) {
    assert.match(html, new RegExp(status));
  }
  assert.doesNotMatch(html, /En revisión/);
  assert.match(html, /Aprobar borrador/);
  assert.match(html, /id="catalog-search"/);
  assert.match(html, /data-filter="edited"/);
  assert.match(html, /statusStorageKey/);
  assert.match(html, /approved.*re-review/);
  assert.match(html, /✎ Editado/);
  assert.match(html, /Reset draft/);
  assert.match(html, /Estado regular/);
  assert.match(html, /Muy buen estado/);
  assert.match(html, /Funciona muy bien/);
  assert.match(html, /Accesorios personales/);
  assert.match(html, /alto × ancho × profundidad/);
  assert.match(html, /Included accessories \(one per line\)/);
  assert.match(html, /Guardar y anterior/);
  assert.match(html, /Guardar y siguiente/);
  assert.match(html, /You have unsaved changes/);
  assert.match(html, /id="confirm-save"/);
  assert.match(html, /id="confirm-discard"/);
  assert.match(html, /id="confirm-cancel"/);
  assert.match(html, /Public photo candidates/);
  assert.match(html, /Use photo.*as main photo/);
  assert.match(html, /Reference-only photos — context only; cannot be selected as the public cover/);
  assert.match(html, /Suggested:.*money\(base\.suggestedAskingPrice\)/);
  assert.match(html, /function editPriceFor/);
  assert.match(html, /currentSellerAskingPrice:base\.currentSellerAskingPrice/);
  assert.match(html, /function enterPhotoMode/);
  assert.match(html, /function movePhoto/);
  assert.match(html, /next<0\|\|next>=item\.images\.length/);
  assert.match(html, /if\(photoMode\).*Escape.*exitPhotoMode\(\);return/s);
  assert.match(html, /if\(!unsavedConfirm\.hidden\|\|!editPanel\.hidden\)return/);
  assert.match(html, /function savedDraft\(\)\{return editableDraft\(itemAt\(\)\)\}/);
  assert.match(html, /JSON\.stringify\(formDraft\(\)\)!==JSON\.stringify\(savedDraft\(\)\)/);
  assert.doesNotMatch(html, /editStartSnapshot/);
  assert.match(html, /dialog\.addEventListener\('cancel',event=>event\.preventDefault\(\)\)/);
  assert.match(html, /event\.stopImmediatePropagation\(\)/);
  assert.match(html, /},true\);/);
  const embeddedScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(embeddedScript);
  assert.doesNotThrow(() => new vm.Script(embeddedScript));
  const priceFunctionSource = html.match(/function editPriceFor\(base,saved\)\{[^}]+\}/)?.[0];
  assert.ok(priceFunctionSource);
  const editPriceFor = vm.runInNewContext(`(${priceFunctionSource.replace('function editPriceFor', 'function')})`);
  assert.equal(editPriceFor({ currentSellerAskingPrice: null, price: null, suggestedAskingPrice: 650000 }, {}), 650000);
  assert.equal(editPriceFor({ currentSellerAskingPrice: 750000, price: 750000, suggestedAskingPrice: 650000 }, {}), 750000);
  assert.equal(editPriceFor({ currentSellerAskingPrice: 750000, price: 750000, suggestedAskingPrice: 650000 }, { price: 700000 }), 700000);
});
