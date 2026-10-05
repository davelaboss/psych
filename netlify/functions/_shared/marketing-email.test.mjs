import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MARKETING_SLOT_KEYS,
  buildImageAttachments,
  buildMarketingEmail,
  isMarketingEligible,
  selectMarketingProducts,
} from './marketing-email.mjs';
import {
  deliverMarketingEmail,
  resolveMarketingDraft,
} from './marketing-email-service.mjs';

function product(number, overrides = {}) {
  return {
    id: `product-${number}`,
    itemNumber: number,
    slug: `product-${number}`,
    title: `Producto ${number}`,
    category: number % 2 ? 'Cocina' : 'Decoración',
    askingPricePYG: 50000 + number * 50000,
    images: [`/images/product-${number}.jpg`],
    status: 'AVAILABLE',
    quantityRemaining: 1,
    needsReview: false,
    isDemo: false,
    ...overrides,
  };
}

function storedDraft(slotDate, slotKey, numbers, id = `${slotKey.toLowerCase()}-draft`) {
  return {
    id,
    slotDate,
    slotKey,
    products: numbers.map(product),
    subject: `Borrador ${slotKey}`,
    socialCopy: `Borrador ${slotKey}`,
    status: 'DRAFT',
    sentAt: null,
  };
}

function draftDependencies({ drafts, numbers, identifiers }) {
  const keyFor = (slotDate, slotKey) => `${slotDate}:${slotKey}`;
  return {
    findCurrent: async (slotDate, slotKey) => drafts.get(keyFor(slotDate, slotKey)) || null,
    loadProducts: async () => numbers.map(product),
    loadHistory: async () => [],
    idFactory: () => identifiers.shift(),
    persist: async ({ packet, regenerate, expectedPacketId }) => {
      const key = keyFor(packet.slotDate, packet.slotKey);
      const current = drafts.get(key);
      if (!regenerate && current) return current;
      if (regenerate) assert.equal(current?.id, expectedPacketId);
      drafts.set(key, packet);
      return packet;
    },
  };
}

test('eligibility excludes every non-public or non-purchasable state', () => {
  assert.equal(isMarketingEligible(product(1)), true);
  for (const candidate of [
    product(2, { status: 'SOLD' }),
    product(3, { status: 'PICKED_UP' }),
    product(4, { status: 'ENTREGADO' }),
    product(5, { status: 'PENDIENTE' }),
    product(6, { status: 'NEEDS_REVIEW' }),
    product(7, { status: 'UNLISTED' }),
    product(8, { needsReview: true }),
    product(9, { hidden: true }),
    product(10, { visible: false }),
    product(11, { published: false }),
    product(12, { quantityRemaining: 0 }),
    product(13, { images: [] }),
    product(14, { askingPricePYG: 0 }),
    product(15, { marketingInventoryVerified: false }),
    product(16, { purchasableQuantity: 0 }),
  ]) assert.equal(isMarketingEligible(candidate), false, `Item ${candidate.itemNumber}`);
});

test('recently featured products rotate out while same-day AM and PM differ', () => {
  const products = [1, 2, 3, 4, 5].map(product);
  const history = [1, 2, 3].map((number, index) => ({
    productId: `product-${number}`,
    featuredAt: `2026-10-0${4 - index}T15:00:00Z`,
    slotDate: '2026-10-05',
    slotKey: 'MONDAY_AM',
  }));
  const selected = selectMarketingProducts({
    products,
    history,
    slotDate: '2026-10-05',
    slotKey: 'MONDAY_PM',
    seed: 'rotation-test',
  });
  assert.deepEqual(selected.map((item) => item.id).sort(), ['product-4', 'product-5']);
});

test('date and slot drafts persist independently and regeneration replaces only the selected draft', async () => {
  const drafts = new Map();
  const identifiers = [
    'am-seed-1', 'am-packet-1',
    'am-seed-2', 'am-packet-2',
    'pm-seed-1', 'pm-packet-1',
  ];
  let productLoads = 0;
  const keyFor = (slotDate, slotKey) => `${slotDate}:${slotKey}`;
  const dependencies = {
    findCurrent: async (slotDate, slotKey) => drafts.get(keyFor(slotDate, slotKey)) || null,
    loadProducts: async () => {
      productLoads += 1;
      return [1, 2, 3, 4, 5, 6, 7, 8].map(product);
    },
    loadHistory: async () => [],
    idFactory: () => identifiers.shift(),
    persist: async ({ packet, regenerate, expectedPacketId }) => {
      const key = keyFor(packet.slotDate, packet.slotKey);
      const current = drafts.get(key);
      if (!regenerate && current) return current;
      if (regenerate) assert.equal(current?.id, expectedPacketId);
      drafts.set(key, packet);
      return packet;
    },
  };
  const input = {
    requestOrigin: 'https://example.com',
    slotDate: '2026-10-05',
    slotKey: 'MONDAY_AM',
    dependencies,
  };

  const firstAm = await resolveMarketingDraft(input);
  const returnedAm = await resolveMarketingDraft(input);
  assert.equal(returnedAm.id, firstAm.id);
  assert.deepEqual(returnedAm.products, firstAm.products);
  assert.equal(productLoads, 1);

  const regeneratedAm = await resolveMarketingDraft({ ...input, regenerate: true });
  assert.notEqual(regeneratedAm.id, firstAm.id);
  assert.equal(
    regeneratedAm.products.some((item) => firstAm.products.some((first) => first.id === item.id)),
    false
  );
  const returnedRegeneration = await resolveMarketingDraft(input);
  assert.equal(returnedRegeneration.id, regeneratedAm.id);
  assert.deepEqual(returnedRegeneration.products, regeneratedAm.products);

  const mondayPm = await resolveMarketingDraft({ ...input, slotKey: 'MONDAY_PM' });
  assert.notEqual(mondayPm.id, regeneratedAm.id);
  assert.equal(drafts.size, 2);
  assert.equal((await resolveMarketingDraft(input)).id, regeneratedAm.id);
});

test('Monday PM excludes persisted Monday AM Item 115 and its other products', async () => {
  const slotDate = '2026-10-05';
  const drafts = new Map([
    [`${slotDate}:MONDAY_AM`, storedDraft(slotDate, 'MONDAY_AM', [115, 275, 312])],
  ]);
  const packet = await resolveMarketingDraft({
    requestOrigin: 'https://example.com',
    slotDate,
    slotKey: 'MONDAY_PM',
    dependencies: draftDependencies({
      drafts,
      numbers: [115, 275, 312, 259, 122, 401, 402],
      identifiers: ['monday-pm-seed', 'monday-pm-packet'],
    }),
  });
  assert.equal(packet.products.some((item) => [115, 275, 312].includes(item.itemNumber)), false);
});

test('Tuesday PM excludes persisted Tuesday AM Item 056 and its other products', async () => {
  const slotDate = '2026-10-06';
  const drafts = new Map([
    [`${slotDate}:TUESDAY_AM`, storedDraft(slotDate, 'TUESDAY_AM', [259, 56, 106])],
  ]);
  const packet = await resolveMarketingDraft({
    requestOrigin: 'https://example.com',
    slotDate,
    slotKey: 'TUESDAY_PM',
    dependencies: draftDependencies({
      drafts,
      numbers: [259, 56, 106, 294, 109, 403, 404],
      identifiers: ['tuesday-pm-seed', 'tuesday-pm-packet'],
    }),
  });
  assert.equal(packet.products.some((item) => [259, 56, 106].includes(item.itemNumber)), false);
});

test('AM excludes the persisted same-day PM draft when PM was generated first', async () => {
  const slotDate = '2026-10-05';
  const drafts = new Map([
    [`${slotDate}:MONDAY_PM`, storedDraft(slotDate, 'MONDAY_PM', [115, 259, 122])],
  ]);
  const packet = await resolveMarketingDraft({
    requestOrigin: 'https://example.com',
    slotDate,
    slotKey: 'MONDAY_AM',
    dependencies: draftDependencies({
      drafts,
      numbers: [115, 259, 122, 275, 312, 405],
      identifiers: ['monday-am-seed', 'monday-am-packet'],
    }),
  });
  assert.equal(packet.products.some((item) => [115, 259, 122].includes(item.itemNumber)), false);
});

test('regenerating AM avoids persisted PM products without changing the PM draft', async () => {
  const slotDate = '2026-10-05';
  const pm = storedDraft(slotDate, 'MONDAY_PM', [259, 122, 401], 'saved-pm');
  const drafts = new Map([
    [`${slotDate}:MONDAY_AM`, storedDraft(slotDate, 'MONDAY_AM', [115, 275, 312], 'old-am')],
    [`${slotDate}:MONDAY_PM`, pm],
  ]);
  const regenerated = await resolveMarketingDraft({
    requestOrigin: 'https://example.com',
    slotDate,
    slotKey: 'MONDAY_AM',
    regenerate: true,
    dependencies: draftDependencies({
      drafts,
      numbers: [115, 275, 312, 259, 122, 401, 501, 502, 503],
      identifiers: ['new-am-seed', 'new-am-packet'],
    }),
  });
  assert.deepEqual(regenerated.products.map((item) => item.itemNumber).sort(), [501, 502, 503]);
  assert.equal(drafts.get(`${slotDate}:MONDAY_PM`), pm);
});

test('regenerating PM avoids persisted AM products without changing the AM draft', async () => {
  const slotDate = '2026-10-06';
  const am = storedDraft(slotDate, 'TUESDAY_AM', [259, 56, 106], 'saved-am');
  const drafts = new Map([
    [`${slotDate}:TUESDAY_AM`, am],
    [`${slotDate}:TUESDAY_PM`, storedDraft(slotDate, 'TUESDAY_PM', [56, 294, 109], 'old-pm')],
  ]);
  const regenerated = await resolveMarketingDraft({
    requestOrigin: 'https://example.com',
    slotDate,
    slotKey: 'TUESDAY_PM',
    regenerate: true,
    dependencies: draftDependencies({
      drafts,
      numbers: [259, 56, 106, 294, 109, 601, 602, 603, 604],
      identifiers: ['new-pm-seed', 'new-pm-packet'],
    }),
  });
  assert.equal(regenerated.products.some((item) => [259, 56, 106].includes(item.itemNumber)), false);
  assert.equal(drafts.get(`${slotDate}:TUESDAY_AM`), am);
});

test('same-day fallback avoids overlap with five eligible products and permits it only below the minimum', async () => {
  const slotDate = '2026-10-05';
  const makeDrafts = () => new Map([
    [`${slotDate}:MONDAY_AM`, storedDraft(slotDate, 'MONDAY_AM', [1, 2, 3])],
  ]);
  const fiveProducts = await resolveMarketingDraft({
    requestOrigin: 'https://example.com',
    slotDate,
    slotKey: 'MONDAY_PM',
    dependencies: draftDependencies({
      drafts: makeDrafts(),
      numbers: [1, 2, 3, 4, 5],
      identifiers: ['five-seed', 'five-packet'],
    }),
  });
  assert.deepEqual(fiveProducts.products.map((item) => item.itemNumber).sort(), [4, 5]);

  const fourProducts = await resolveMarketingDraft({
    requestOrigin: 'https://example.com',
    slotDate,
    slotKey: 'MONDAY_PM',
    dependencies: draftDependencies({
      drafts: makeDrafts(),
      numbers: [1, 2, 3, 4],
      identifiers: ['four-seed', 'four-packet'],
    }),
  });
  assert.equal(fourProducts.products.length, 3);
  assert.equal(fourProducts.products.some((item) => [1, 2, 3].includes(item.itemNumber)), true);
});

test('selector returns two good products instead of forcing a third bulky item', () => {
  const selected = selectMarketingProducts({
    products: [
      product(1, { category: 'Muebles', requiresVehicle: true }),
      product(2, { category: 'Muebles', requiresVehicle: true }),
      product(3, { category: 'Muebles', requiresVehicle: true }),
    ],
    slotDate: '2026-10-05',
    slotKey: 'MONDAY_AM',
    seed: 'bulky-test',
  });
  assert.equal(selected.length, 2);
});

test('all weekday AM and PM templates render distinct subjects and copy', () => {
  const products = [product(22), product(49)];
  const rendered = MARKETING_SLOT_KEYS.map((slotKey) =>
    buildMarketingEmail({ slotKey, products, origin: 'https://example.com' })
  );
  assert.equal(new Set(rendered.map((email) => email.subject)).size, 10);
  assert.equal(new Set(rendered.map((email) => email.socialCopy)).size, 10);
  assert.match(rendered[0].subject, /Monday AM/);
  assert.match(rendered[1].subject, /Monday PM/);
});

test('email contains copy, photos, direct links, and a mobile-safe width', () => {
  const email = buildMarketingEmail({
    slotKey: 'MONDAY_PM',
    products: [product(22), product(49)],
    origin: 'https://example.com',
  });
  assert.match(email.html, /1\. LISTO PARA COPIAR Y PEGAR/);
  assert.match(email.html, /2\. FOTOS PARA PUBLICAR/);
  assert.match(email.html, /3\. ENLACES DIRECTOS/);
  assert.match(email.html, /max-width:620px/);
  assert.match(email.html, /https:\/\/example\.com\/producto\/product-22/);
  assert.match(email.text, /Item-022\.jpg/);
  assert.match(email.socialCopy, /Sin delivery ni envíos/);
});

test('image attachments are generated as clearly named JPEG files', async () => {
  const calls = [];
  const attachments = await buildImageAttachments(
    [product(22), product(49)],
    'https://example.com',
    async (url) => {
      calls.push(url);
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }
  );
  assert.deepEqual(attachments.map((attachment) => attachment.filename), ['Item-022.jpg', 'Item-049.jpg']);
  assert.ok(attachments.every((attachment) => attachment.content_type === 'image/jpeg'));
  assert.ok(calls.every((url) => url.includes('fm=jpg')));
});

test('Resend delivery uses the displayed draft and a stable duplicate-send key', async () => {
  const previous = {
    key: process.env.RESEND_API_KEY,
    to: process.env.MARKETING_EMAIL_TO,
    from: process.env.MARKETING_EMAIL_FROM,
  };
  process.env.RESEND_API_KEY = 'test-key';
  process.env.MARKETING_EMAIL_TO = 'maria@example.com';
  process.env.MARKETING_EMAIL_FROM = 'Venta <ventas@example.com>';
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ id: 'email-test' });
  };
  const packet = {
    subject: 'Venta de mudanza | Monday PM',
    html: '<p>Borrador mostrado</p>',
    text: 'Borrador mostrado',
    idempotencyKey: 'marketing/2026-10-05/MONDAY_PM/packet-test',
  };
  const attachments = [{ filename: 'Item-022.jpg', content: '/9j/2Q==', content_type: 'image/jpeg' }];
  try {
    await deliverMarketingEmail({ packet, attachments, fetchImpl });
    await deliverMarketingEmail({ packet, attachments, fetchImpl });
    assert.equal(requests.length, 2);
    for (const request of requests) {
      const payload = JSON.parse(request.options.body);
      assert.deepEqual(payload.to, ['maria@example.com']);
      assert.equal(payload.subject, packet.subject);
      assert.equal(payload.html, packet.html);
      assert.equal(payload.text, packet.text);
      assert.deepEqual(payload.attachments, attachments);
      assert.equal(request.options.headers['Idempotency-Key'], packet.idempotencyKey);
    }
  } finally {
    if (previous.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.to === undefined) delete process.env.MARKETING_EMAIL_TO;
    else process.env.MARKETING_EMAIL_TO = previous.to;
    if (previous.from === undefined) delete process.env.MARKETING_EMAIL_FROM;
    else process.env.MARKETING_EMAIL_FROM = previous.from;
  }
});
