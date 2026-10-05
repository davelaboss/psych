import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MARKETING_SLOT_KEYS,
  buildImageAttachments,
  buildMarketingEmail,
  isMarketingEligible,
  selectMarketingProducts,
} from './marketing-email.mjs';
import { deliverMarketingEmail } from './marketing-email-service.mjs';

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

test('Resend delivery uses one recipient and a stable idempotency key', async () => {
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
    html: '<p>Correo</p>',
    text: 'Correo',
    idempotencyKey: 'marketing/2026-10-05/MONDAY_PM/packet-test',
  };
  try {
    await deliverMarketingEmail({ packet, attachments: [], fetchImpl });
    await deliverMarketingEmail({ packet, attachments: [], fetchImpl });
    assert.equal(requests.length, 2);
    for (const request of requests) {
      const payload = JSON.parse(request.options.body);
      assert.deepEqual(payload.to, ['maria@example.com']);
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
