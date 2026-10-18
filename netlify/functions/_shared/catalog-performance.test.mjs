import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import {
  jsonResponse, listProductOverrides, loadBaseCatalog, loadCatalog, loadPublicCatalog,
} from './commerce.mjs';
import { catalogBatchProducts } from './volume2-public.mjs';
import { selectPreviewProduct, buildProductPreviewMetadata } from './product-preview.mjs';

const origin = 'https://example.test';
const product = (id, fields = {}) => ({
  id, slug: `product-${id}`, title: `Product ${id}`, itemNumber: Number(id),
  category: 'Hogar', description: 'Hay 3 unidades disponibles.',
  status: 'AVAILABLE', quantityTotal: 3, quantityRemaining: 3, quantitySold: 0,
  askingPricePYG: 90000, images: ['/original.jpg'], saleMode: 'DELAYED',
  pickupAvailableDate: '2026-12-09', pickupWindowStart: '2026-12-09',
  pickupWindowEnd: '2026-12-12', sellerConfirmedFields: ['condition'], ...fields,
});
const inputs = (products, overrides = [], inventory = new Map()) => ({
  loadBaseCatalog: async () => structuredClone(products),
  listProductOverrides: async () => structuredClone(overrides),
  readCommittedInventory: async () => inventory,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('local base equals the prior embedded source plus merchandising, field for field', async () => {
  const html = await readFile(new URL('../../../index.html', import.meta.url), 'utf8');
  // Decode the original RSC envelope independently of the server's array scanner.
  const chunks = [...html.matchAll(/\.rsc\.push\(("(?:\\.|[^"\\])*")\)/g)]
    .map(match => JSON.parse(match[1]));
  const chunk = chunks.find(value => value.includes('"products":'));
  assert.ok(chunk, 'committed legacy payload must exist');
  // The existing catalog scanner preserves escaped newlines as literal text.
  // Preserve that contract rather than normalizing buyer-facing content here.
  const original = JSON.parse(chunk.slice(chunk.indexOf(':') + 1), (_key, value) =>
    typeof value === 'string' ? value.replace(/\n/g, '\\n') : value)[3].products;
  const batch = catalogBatchProducts();
  const expected = [...new Map([...original, ...batch].filter(p => p?.id).map(p => [p.id, p])).values()]
    .filter(p => p.status !== 'UNLISTED').sort((a, b) => Number(a.itemNumber) - Number(b.itemNumber));
  const actual = await loadBaseCatalog(origin);
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.deepEqual(value, expected[index], value.id));
  assert.ok(original.length > 0 && batch.length > 0);
  assert.ok(original.every(p => p.status === 'UNLISTED' || actual.some(a => a.id === p.id)));
  assert.ok(batch.every(p => actual.some(a => a.id === p.id)));
  assert.ok(actual.some(p => Number(p.itemNumber) === 1));
  assert.ok(actual.some(p => Number(p.itemNumber) === 313));
});

test('base source needs no network and each call returns independent product data', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected root self-fetch'); });
  const first = await loadBaseCatalog(origin);
  const second = await loadBaseCatalog('https://another-deployment.test');
  assert.deepEqual(first, second);
  first[0].title = 'caller mutation';
  first[0].images.push('/caller-mutation.jpg');
  assert.notEqual(second[0].title, first[0].title);
  assert.equal(second[0].images.includes('/caller-mutation.jpg'), false);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('all catalog inputs begin before any completes and output remains sorted', async () => {
  const stages = [deferred(), deferred(), deferred()];
  const started = [];
  const result = loadCatalog(origin, {
    loadBaseCatalog: url => { assert.equal(url, origin); started.push('base'); return stages[0].promise; },
    listProductOverrides: () => { started.push('overrides'); return stages[1].promise; },
    readCommittedInventory: () => { started.push('inventory'); return stages[2].promise; },
  });
  assert.deepEqual(started, ['base', 'overrides', 'inventory']);
  stages[2].resolve(new Map([['2', { capacity: 3, committed_quantity: 1 }]]));
  stages[1].resolve([{ productId: '2', publicFields: { title: 'Updated' } }]);
  stages[0].resolve([product('2'), product('1')]);
  const catalog = await result;
  assert.deepEqual(catalog.map(p => p.id), ['1', '2']);
  assert.equal(catalog[1].title, 'Updated');
  assert.equal(catalog[1].quantityRemaining, 2);
});

for (const stage of ['loadBaseCatalog', 'listProductOverrides', 'readCommittedInventory']) {
  test(`${stage} failures still reject the entire authoritative catalog`, async () => {
    const failure = new Error(`Failed ${stage}`);
    await assert.rejects(loadCatalog(origin, {
      ...inputs([product('1')]), [stage]: async () => { throw failure; },
    }), error => error === failure);
  });
}

test('overrides preserve public fields, images, seller confirmations and untouched products', async () => {
  const unchanged = product('2');
  const result = await loadCatalog(origin, inputs([product('1'), unchanged], [{
    productId: '1', publicFields: { title: 'Confirmed', askingPricePYG: 123000, sellerConfirmedFields: ['title', 'condition'] },
    images: ['/override-a.jpg', '/override-b.jpg'], internalNotes: 'private override metadata',
  }]));
  assert.deepEqual(result[0], { ...product('1'), title: 'Confirmed', askingPricePYG: 123000,
    sellerConfirmedFields: ['title', 'condition'], images: ['/override-a.jpg', '/override-b.jpg'] });
  assert.deepEqual(result[1], unchanged);
  assert.equal(Object.hasOwn(result[0], 'internalNotes'), false);
  const cleared = await loadCatalog(origin, inputs([product('1')], [{ productId: '1', images: null }]));
  assert.deepEqual(cleared[0].images, []);
});

for (const committed of [0, 1, 3]) {
  test(`committed inventory ${committed}/3 preserves quantities, status and approved fields`, async () => {
    const [actual] = await loadCatalog(origin, inputs([product('1')], [], new Map([
      ['1', { capacity: 3, committed_quantity: committed }],
    ])));
    assert.deepEqual(actual, { ...product('1'), quantityRemaining: 3 - committed, quantitySold: committed,
      status: committed === 3 ? 'SOLD' : 'AVAILABLE',
      description: committed === 3 ? 'No quedan unidades disponibles.' : `Hay ${3 - committed} unidades disponibles.`,
    });
  });
}

test('inventory respects override quantity limits, existing sold counts and non-public statuses', async () => {
  const result = await loadCatalog(origin, inputs([product('1'), product('2', { status: 'NEEDS_REVIEW' })], [
    { productId: '1', publicFields: { quantityRemaining: 2, quantitySold: 2 } },
  ], new Map([
    ['1', { capacity: 3, committed_quantity: 1 }], ['2', { capacity: 3, committed_quantity: 3 }],
  ])));
  assert.equal(result[0].quantityRemaining, 1);
  assert.equal(result[0].quantitySold, 2);
  assert.equal(result[1].status, 'NEEDS_REVIEW');
});

test('public delivery and social projections preserve exclusion, SOLD and limited delivered fields', async () => {
  const fixtures = [product('1'), product('2'), product('3'), product('4'), product('5')];
  const overrides = [
    { productId: '2', publicFields: { status: 'UNLISTED' } },
    { productId: '3', publicFields: { status: 'NEEDS_REVIEW' } },
  ];
  const inventory = new Map(['4', '5'].map(id => [id, { capacity: 3, committed_quantity: 3 }]));
  const dependencies = {
    loadCatalog: url => loadCatalog(url, inputs(fixtures, overrides, inventory)),
    readFulfillmentDeliveryRows: async () => [{ product_id: '5', quantity: 1, fulfillment_batch_id: 'delivered', batch_status: 'DELIVERED' }],
  };
  const result = await loadPublicCatalog(origin, { requestedSlug: 'product-5' }, dependencies);
  assert.deepEqual(result.products.map(p => p.id), ['1', '4']);
  assert.deepEqual(result.deliveredProduct, { id: '5', slug: 'product-5', title: 'Product 5', itemNumber: 5, category: 'Hogar' });
  for (const id of ['1', '4']) assert.ok(buildProductPreviewMetadata(selectPreviewProduct(result.products, `product-${id}`), origin));
  for (const id of ['2', '3', '5']) assert.equal(selectPreviewProduct(result.products, `product-${id}`), null);
  assert.equal(buildProductPreviewMetadata(result.deliveredProduct, origin), null);
  assert.equal((await loadPublicCatalog(origin, {}, dependencies)).deliveredProduct, null);
});

test('Item 054/058 corrective behavior survives overrides and inventory projection', async () => {
  const note = 'Desgaste por uso normal con detalles. Burlete superior con pequeño corte que no afecta el sellado. Compartimiento inferior con reparación de una grieta.';
  const actual = await loadCatalog(origin, inputs([
    product('58', { knownDefects: '' }), product('54', { knownDefects: '' }),
  ], [{ productId: '54', publicFields: { knownDefects: note } }]));
  assert.equal(actual[0].knownDefects, '');
  assert.equal(actual[1].knownDefects, note);
});

test('Blob reads are bounded at eight, strongly consistent, complete and ordered across waves', async () => {
  const blobs = Array.from({ length: 19 }, (_, i) => ({ key: `product:${i}` }));
  const pending = new Map();
  const reads = [];
  let active = 0, maximum = 0;
  const result = listProductOverrides({ store: {
    list: async options => { assert.deepEqual(options, { prefix: 'product:' }); return { blobs }; },
    get: async (key, options) => {
      assert.deepEqual(options, { type: 'json', consistency: 'strong' });
      active++; maximum = Math.max(maximum, active); reads.push(key);
      const gate = deferred(); pending.set(key, gate);
      const value = await gate.promise;
      active--; return value;
    },
  } });
  await setImmediate();
  assert.equal(active, 8);
  while (pending.size) {
    for (const [key, gate] of [...pending].reverse()) {
      pending.delete(key); gate.resolve({ productId: key, publicFields: { title: key } });
    }
    await setImmediate();
  }
  assert.equal(maximum, 8);
  assert.deepEqual(reads, blobs.map(blob => blob.key));
  assert.deepEqual((await result).map(value => value.productId), blobs.map(blob => blob.key));
});

test('parallel completion preserves last override precedence for duplicate product IDs', async () => {
  const slow = deferred();
  const result = listProductOverrides({ store: {
    list: async () => ({ blobs: [{ key: 'first' }, { key: 'last' }] }),
    get: async key => key === 'first' ? slow.promise : { productId: '1', publicFields: { title: 'last wins' } },
  } });
  await setImmediate();
  slow.resolve({ productId: '1', publicFields: { title: 'first' } });
  const [actual] = await loadCatalog(origin, inputs([product('1')], await result));
  assert.equal(actual.title, 'last wins');
});

test('Blob list and individual read errors propagate instead of dropping overrides', async () => {
  const failure = new Error('Blob unavailable');
  await assert.rejects(listProductOverrides({ store: { list: async () => { throw failure; } } }), error => error === failure);
  await assert.rejects(listProductOverrides({ store: {
    list: async () => ({ blobs: [{ key: 'product:ok' }, { key: 'product:failed' }] }),
    get: async key => { if (key.endsWith('failed')) throw failure; return { productId: 'ok' }; },
  } }), error => error === failure);
});

test('empty lists and deleted Blob values retain prior semantics', async () => {
  assert.deepEqual(await listProductOverrides({ store: { list: async () => ({}) } }), []);
  assert.deepEqual(await listProductOverrides({ store: {
    list: async () => ({ blobs: [{ key: 'missing' }, { key: 'present' }] }),
    get: async key => key === 'missing' ? null : { productId: 'present' },
  } }), [{ productId: 'present' }]);
});

test('every public call reloads overrides, committed inventory and fulfillment rows', async () => {
  let requests = 0, overrideReads = 0, inventoryReads = 0, deliveryReads = 0;
  const dependencies = {
    loadCatalog: url => loadCatalog(url, {
      loadBaseCatalog: async () => [product('1')],
      listProductOverrides: async () => { overrideReads++; return [{ productId: '1', publicFields: { title: `Revision ${requests}` } }]; },
      readCommittedInventory: async () => { inventoryReads++; return new Map([['1', { capacity: 3, committed_quantity: requests * 3 }]]); },
    }),
    readFulfillmentDeliveryRows: async () => { deliveryReads++; return requests === 2
      ? [{ product_id: '1', quantity: 1, fulfillment_batch_id: 'done', batch_status: 'DELIVERED' }] : []; },
  };
  const first = await loadPublicCatalog(origin, {}, dependencies);
  requests = 1;
  const second = await loadPublicCatalog(origin, {}, dependencies);
  requests = 2;
  const third = await loadPublicCatalog(origin, { requestedSlug: 'product-1' }, dependencies);
  assert.equal(first.products[0].status, 'AVAILABLE');
  assert.equal(second.products[0].status, 'SOLD');
  assert.equal(second.products[0].title, 'Revision 1');
  assert.deepEqual(third.products, []);
  assert.equal(third.deliveredProduct.title, 'Revision 2');
  assert.deepEqual([overrideReads, inventoryReads, deliveryReads], [3, 3, 3]);
});

test('catalog response keeps its schema and no-store, including method failures', async () => {
  const payload = { ok: true, products: [product('1')], deliveredProduct: null };
  const response = jsonResponse(payload);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), payload);
  const { default: handler } = await import('../volume2-catalog.mjs');
  const rejected = await handler(new Request(origin, { method: 'POST' }));
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('cache-control'), 'no-store');
  const config = await readFile(new URL('../../../netlify.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\][\s\S]*included_files\s*=\s*\["index\.html"\]/);
});
