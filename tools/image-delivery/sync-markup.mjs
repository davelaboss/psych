// Refresh only image display attributes in the maintained HTML shell.
// Never touches embedded product data or original files.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { deliveryUrl, sourceKey, SIZES } from './verify.mjs';
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
export function optimizeMarkup(html, manifest) {
return html.replace(/<img\b[^>]*>/g, tag => {
  const match = tag.match(/\bdata-original-src="([^"]+)"/) || tag.match(/\bsrc="([^"]+)"/);
  if (!match) return tag;
  const original = match[1].replaceAll('&amp;', '&');
  const size = /class="brand-photo"/.test(tag) ? 'brand' : 'small';
  if (!manifest[sourceKey(original)]?.includes(size)) return tag.replace(/\ssrc="[^"]+"/, ' src="' + escape(original) + '"');
  const src = deliveryUrl(original, SIZES[size]);
  let next = tag.replace(/\ssrc="[^"]+"/, ' src="' + escape(src) + '"');
  if (!/\bdata-original-src=/.test(next)) next = next.replace(/\ssrc="/, ' data-original-src="' + escape(new URL(original, 'https://images.invalid').pathname + new URL(original, 'https://images.invalid').search) + '" src="');
  if (!/\bdecoding=/.test(next)) next = next.replace(/\s*\/?>(\s*)$/, ' decoding="async" />$1');
  return next;
});
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const context = { window: {} };
  vm.runInNewContext(await fs.readFile('js/image-delivery-manifest.js', 'utf8'), context);
  const html = await fs.readFile('index.html', 'utf8');
  await fs.writeFile('index.html', optimizeMarkup(html, context.window.__imageDeliveryManifest));
}
