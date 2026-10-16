import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildWhatsAppProductShareHref as buildSourceShareHref } from '../../../source/lib/product-sharing.ts';

const storefrontSource = readFileSync('js/site.js', 'utf8');
const sourceComponent = readFileSync('source/components/product-actions.tsx', 'utf8');

const helperStart = storefrontSource.indexOf('function buildWhatsAppProductShareHref');
const helperEnd = storefrontSource.indexOf('function renderProductDetail', helperStart);
assert.notEqual(helperStart, -1, 'root share helper should exist');
assert.notEqual(helperEnd, -1, 'root share helper should precede product rendering');
const buildRootShareHref = Function(
  'formatPYG',
  `${storefrontSource.slice(helperStart, helperEnd)}; return buildWhatsAppProductShareHref;`
)(value => `Gs. ${Number(value).toLocaleString('es-PY')}`);

const item313 = {
  slug: 'ups-apc-easy-ups-srv2ki-de-2000-va-2-kva-1-6-kw-item-313',
  title: 'UPS APC Easy UPS SRV2KI de 2000 VA',
  askingPricePYG: 3_500_000,
};

function decodeShareHref(href) {
  const url = new URL(href);
  return { url, message: url.searchParams.get('text') };
}

test('product share uses the generic WhatsApp recipient picker and excludes the seller number', () => {
  const href = buildRootShareHref(item313);
  const { url } = decodeShareHref(href);

  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/');
  assert.doesNotMatch(href, /595972588347/);
});

test('product share message identifies the product and contains the exact Item 313 URL', () => {
  const { message } = decodeShareHref(buildRootShareHref(item313));

  assert.match(message, /Mirá este artículo de la venta de mudanza:/);
  assert.match(message, /UPS APC Easy UPS SRV2KI de 2000 VA/);
  assert.match(message, /Gs\. 3\.500\.000/);
  assert.match(
    message,
    /https:\/\/thelabossieres\.com\/producto\/ups-apc-easy-ups-srv2ki-de-2000-va-2-kva-1-6-kw-item-313/
  );
});

test('seller-addressed WhatsApp destination remains on Consultar only', () => {
  const inquiryMarkup = storefrontSource.slice(
    storefrontSource.lastIndexOf('<a', storefrontSource.indexOf('Consultar por WhatsApp')),
    storefrontSource.indexOf('</a>', storefrontSource.indexOf('Consultar por WhatsApp'))
  );
  const shareMarkup = storefrontSource.slice(
    storefrontSource.lastIndexOf('<a', storefrontSource.indexOf('Compartir por WhatsApp')),
    storefrontSource.indexOf('</a>', storefrontSource.indexOf('Compartir por WhatsApp'))
  );

  assert.match(inquiryMarkup, /https:\/\/wa\.me\/595972588347\?text=/);
  assert.doesNotMatch(shareMarkup, /595972588347/);
  assert.match(shareMarkup, /buildWhatsAppProductShareHref\(product\)/);
});

test('share control retains its visible label and decorative connected-node icon', () => {
  for (const implementation of [storefrontSource, sourceComponent]) {
    const labelIndex = implementation.indexOf('Compartir por WhatsApp');
    const nearbyMarkup = implementation.slice(Math.max(0, labelIndex - 1_200), labelIndex + 100);

    assert.notEqual(labelIndex, -1);
    assert.match(nearbyMarkup, /<svg/);
    assert.match(nearbyMarkup, /aria-hidden=(?:"true"|\{"true"\})/);
    assert.match(nearbyMarkup, /stroke=(?:"currentColor"|\{"currentColor"\})/);
    assert.equal((nearbyMarkup.match(/<circle/g) || []).length, 3);
  }
});

test('root and source share builders stay logically aligned', () => {
  assert.equal(buildRootShareHref(item313), buildSourceShareHref(item313));
  assert.doesNotMatch(sourceComponent, /const share = useMemo\(\(\) => `\$\{base\}/);
  assert.match(sourceComponent, /const inquiry = useMemo\(\(\) => `\$\{base\}/);
});
