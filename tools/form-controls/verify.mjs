// Offline browser regression checks. No production order or payment is created.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const output = path.resolve(process.env.FORM_QA_OUTPUT || 'work/form-qa');
await mkdir(output, { recursive: true });
const baseline = process.env.FORM_QA_BASE || 'e70e8d22319dd89cfa7ba027557a6b1f74ffbdc6';
const source = (file, before) => before
  ? execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })
  : readFile(path.join(root, file), 'utf8');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  if (url.pathname === '/.netlify/functions/volume2-catalog') return json({ products: [product] });
  if (url.pathname === '/api/cart/reservation') return json({ lease: { expiresAt: Date.now() + 7200000, items: { 'fixture-product': 1 } } });
  if (url.pathname === '/api/orders/get') return json({ order });
  if (url.pathname === '/api/orders/pickup') return json({ fulfillments: [{ timingKey: 'IMMEDIATE', timingLabel: 'Retiro', eligible: true, slots: [{ key: 'LOCAL', label: '9 de diciembre, 09:00–10:00', remaining: 1 }] }] });
  if (url.pathname.startsWith('/api/')) return json({ ok: true });
  if (/^\/(css|js|_next)\//.test(url.pathname)) {
    try {
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep)) throw new Error('outside root');
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end(); }
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname !== '/__qa') { res.end(await readFile('index.html', 'utf8')); return; }
  res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const checks = [];
function check(name, condition) { assert.ok(condition, name); checks.push(name); }
const product = { id: 'fixture-product', itemNumber: 999, slug: 'articulo-de-prueba', title: 'Artículo de prueba', category: 'Hogar', tags: [], images: [], description: 'Descripción de prueba', condition: 'Usado', conditionNotes: '', knownDefects: '', includedAccessories: [], logisticsNotes: [], askingPricePYG: 100000, saleMode: 'IMMEDIATE', depositPercent: 100, status: 'AVAILABLE', quantityTotal: 2, quantityRemaining: 2, purchasableQuantity: 2 };
const order = {
  id: 'VM-PRUEBA-LOCAL', status: 'AWAITING_INITIAL_PAYMENT',
  buyer: { name: 'Comprador de prueba' }, items: [{ ...product, productId: product.id, quantity: 1, dueNowPYG: 100000, futureBalancePYG: 0 }], payments: [],
  totals: { totalPYG: 100000, dueNowPYG: 100000, futureBalancePYG: 0 },
  bank: { configured: true, accountName: 'Cuenta de demostración', identification: 'Datos de prueba',
    bankName: 'Banco de prueba', accountNumber: '000000', currency: 'PYG', alias: 'ALIAS.DE.PRUEBA' },
};
async function fixture(page, before, view) {
  await page.goto(`http://127.0.0.1:${server.address().port}/__qa`);
  await page.addStyleTag({ content: await source('css/site.css', before) });
  if (!before) await page.addStyleTag({ content: await source('css/form-controls.css', false) });
  const site = await source('js/site.js', before);
  for (const name of ['formatPYG', 'escapeHtml']) {
    const start = site.indexOf(`function ${name}(`);
    const end = site.indexOf('\nfunction ', start + 1);
    await page.addScriptTag({ content: site.slice(start, end < 0 ? undefined : end) });
  }
  await page.addScriptTag({ content: await source('js/checkout.js', before) });
  await page.addScriptTag({ content: await source('js/admin.js', before) });
  await page.evaluate(({ view, order }) => {
    injectCheckoutStyles();
    injectAdminStyles();
    if (view === 'payment') {
      document.querySelector('main').innerHTML = `<section class="order-shell"><h1>Pago del pedido · prueba local</h1><aside class="cart-summary">${renderBankSection(order, 'local-only')}</aside></section>`;
      setupReceiptUpload(order, 'local-only');
      setupBankAliasCopy(order.bank.alias);
    } else {
      document.querySelector('main').innerHTML = `<section class="admin-shell"><h1>Editar artículo · prueba local</h1><form class="admin-data-editor"><div class="admin-filter-grid">${adminEditorInput('Nombre', 'title', 'Mesa de demostración')}${adminEditorInput('Precio pedido (Gs.)', 'askingPricePYG', 100000, 'number')}${adminEditorInput('Fecha mínima de retiro', 'pickupAvailableDate', '2026-12-09', 'date')}<label><span>Modalidad</span><select name="saleMode"><option>Disponible ahora</option><option>Retiro posterior</option></select></label>${adminEditorTextarea('Descripción pública', 'description', 'Descripción de prueba')}${adminEditorTextarea('Notas internas', 'internalNotes', '')}</div><label class="admin-editor-checkbox"><input type="checkbox"> Requiere vehículo</label><label><span>Comprobante recibido</span><input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label><button type="submit" class="primary-action">Guardar cambios</button></form></section>`;
    }
  }, { view, order });
  if (!before) {
    await page.addScriptTag({ content: await source('js/form-controls.js', false) });
    await page.locator('.file-picker').waitFor();
  }
}
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, locale: 'en-US' });
    for (const view of ['payment', 'admin']) {
      for (const before of [true, false]) {
        await fixture(page, before, view);
        await page.screenshot({ path: path.join(output, `${view}-${width}-${before ? 'before' : 'after'}.png`), fullPage: true });
        if (!before) {
          check(`${view}/${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          check(`${view}/${width}: Spanish empty picker`, await page.locator('.file-picker-name').textContent() === 'Ningún archivo seleccionado');
          check(`${view}/${width}: native input visually concealed`, await page.locator('.file-picker-input').evaluate(el => getComputedStyle(el).opacity === '0'));
          await page.locator('.file-picker-input').focus();
          await page.keyboard.press('Tab');
          check(`${view}/${width}: keyboard can leave picker`, await page.locator('.file-picker-input').evaluate(el => el !== document.activeElement));
        }
      }
    }
    await fixture(page, false, 'payment');
    check(`${width}: Alias remains readonly`, await page.locator('#bank-alias-value').getAttribute('readonly') !== null);
    await page.getByRole('button', { name: 'Enviar comprobante' }).click();
    check(`${width}: required validation Spanish in English browser`, await page.locator('input[type=file]').evaluate(el => el.validationMessage === 'Selecciona un archivo.'));
    const file = page.locator('input[type=file]');
    const chooserPromise = page.waitForEvent('filechooser');
    await file.press('Space');
    const chooser = await chooserPromise;
    await chooser.setFiles([]);
    check(`${width}: keyboard opens real native file chooser`, !chooser.isMultiple());
    const longName = 'comprobante-'.repeat(18) + '<prueba>.pdf';
    await file.setInputFiles({ name: longName, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-test') });
    check(`${width}: long filename shown as literal text`, await page.locator('.file-picker-name').textContent() === longName);
    check(`${width}: long filename does not overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `payment-${width}-long-filename.png`), fullPage: true });
    for (const [name, mimeType, buffer, expected] of [
      ['archivo.txt', 'text/plain', Buffer.from('invalid'), 'JPEG, PNG, WebP o PDF'],
      ['grande.pdf', 'application/pdf', Buffer.alloc(3_000_001), 'entre 1 byte y 3 MB'],
      ['vacío.pdf', 'application/pdf', Buffer.alloc(0), 'entre 1 byte y 3 MB'],
    ]) {
      await file.setInputFiles({ name, mimeType, buffer });
      await page.getByRole('button', { name: 'Enviar comprobante' }).click();
      check(`${width}: rejects ${name} in Spanish`, (await page.locator('#receipt-error').textContent()).includes(expected));
      check(`${width}: invalid upload returns focus to file`, await file.evaluate(el => el === document.activeElement && el.getAttribute('aria-invalid') === 'true'));
    }
    await page.screenshot({ path: path.join(output, `payment-${width}-error.png`), fullPage: true });
    for (const failure of ['server', 'network']) {
      await page.evaluate(failure => {
        window.fetch = async () => {
          if (failure === 'network') throw new TypeError('Failed to fetch');
          return { ok: false, json: async () => ({ error: 'Este pedido no admite otro comprobante en este momento.' }) };
        };
      }, failure);
      await file.setInputFiles({ name: 'comprobante.pdf', mimeType: 'application/pdf', buffer: Buffer.from('local fixture') });
      await page.getByRole('button', { name: 'Enviar comprobante' }).click();
      const text = await page.locator('#receipt-error').textContent();
      check(`${width}: ${failure} failure Spanish and retry enabled`, text.includes(failure === 'network' ? 'No se pudo enviar' : 'Este pedido no admite') && await page.getByRole('button', { name: 'Enviar comprobante' }).isEnabled());
      check(`${width}: ${failure} failure preserves selected filename`, await page.locator('.file-picker-name').textContent() === 'comprobante.pdf');
    }
    await page.evaluate(() => document.getElementById('receipt-form').reset());
    await page.waitForFunction(() => document.querySelector('.file-picker-name').textContent === 'Ningún archivo seleccionado');
    check(`${width}: reset clears filename and error state`, await file.evaluate(el => !el.getAttribute('aria-invalid') && el.files.length === 0));
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      await fixture(page, false, 'payment');
      await page.evaluate(() => {
        window.displayOrder = () => { document.querySelector('main').innerHTML = '<p role="status">Comprobante recibido</p>'; };
        window.fetch = async (url, options) => {
          window.lastUpload = { url, method: options.method, orderId: options.body.get('orderId'), access: options.body.get('access'), type: options.body.get('file').type };
          return { ok: true, json: async () => ({ order: { status: 'RECEIPT_RECEIVED' } }) };
        };
      });
      await page.locator('input[type=file]').setInputFiles({ name: 'comprobante', mimeType, buffer: mimeType === 'application/pdf' ? Buffer.alloc(3_000_000) : Buffer.from('local fixture') });
      await page.getByRole('button', { name: 'Enviar comprobante' }).click();
      const uploaded = await page.evaluate(() => window.lastUpload);
      check(`${width}: ${mimeType} retains upload payload and authorization`, uploaded.url === '/api/orders/receipt' && uploaded.method === 'POST' && uploaded.orderId === order.id && uploaded.access === 'local-only' && uploaded.type === mimeType);
      check(`${width}: success Spanish`, await page.getByRole('status').textContent() === 'Comprobante recibido');
    }
    await fixture(page, false, 'admin');
    const fields = await page.locator('input:not([type=file]):not([type=checkbox]), select, textarea').evaluateAll(els => els.map(el => ({ bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderColor, size: parseFloat(getComputedStyle(el).fontSize), label: !!el.closest('label') })));
    check(`${width}: Admin fields white, bordered, labeled, 16px minimum`, fields.every(f => f.bg === 'rgb(255, 255, 255)' && f.border === 'rgb(117, 135, 124)' && f.size >= 16 && f.label));
    await page.locator('textarea').first().focus();
    check(`${width}: visible keyboard focus`, await page.locator('textarea').first().evaluate(el => getComputedStyle(el).outlineStyle === 'solid'));
    await page.screenshot({ path: path.join(output, `admin-${width}-focus.png`), fullPage: true });
    await page.evaluate(() => {
      const form = document.querySelector('form');
      for (const type of ['text', 'search', 'tel', 'email', 'password', 'number', 'date', 'url']) {
        const label = document.createElement('label');
        label.textContent = `Campo de prueba: ${type}`;
        const input = document.createElement('input');
        input.type = type;
        label.append(input);
        form.append(label);
      }
      const hidden = document.createElement('input'); hidden.type = 'hidden'; form.append(hidden);
      const disabled = document.createElement('input'); disabled.disabled = true; disabled.id = 'qa-disabled'; form.append(disabled);
    });
    check(`${width}: all editable field types visibly bounded`, await page.locator('input:not([type=file]):not([type=checkbox]):not([type=hidden]):not(:disabled)').evaluateAll(els => els.every(el => getComputedStyle(el).borderStyle === 'solid' && getComputedStyle(el).minHeight === '44px')));
    check(`${width}: disabled appearance distinct`, await page.locator('#qa-disabled').evaluate(el => getComputedStyle(el).borderStyle === 'dashed' && getComputedStyle(el).backgroundColor === 'rgb(238, 238, 232)'));
    check(`${width}: hidden input stays hidden`, await page.locator('input[type=hidden]').evaluate(el => getComputedStyle(el).display === 'none'));
    await page.locator('input[type=email]').fill('incorrecto');
    await page.locator('input[type=email]').evaluate(el => el.reportValidity());
    check(`${width}: invalid email has Spanish explanation and thicker border`, await page.locator('input[type=email]').evaluate(el => el.validationMessage === 'Escribe un correo electrónico válido.' && getComputedStyle(el).borderTopWidth === '2px'));
    for (const tab of ['inventory', 'review', 'pricing', 'marketing', 'orders']) {
      await page.evaluate(tab => {
        document.querySelector('main').innerHTML = '<section class="admin-shell"><div id="admin-tab-content"></div></section>';
        ADMIN_STATE.inventory = []; ADMIN_STATE.orders = [];
        const defaults = marketingDefaults();
        ADMIN_STATE.marketingDate = defaults.date; ADMIN_STATE.marketingSlotKey = defaults.slotKey;
        ADMIN_STATE.marketingLoadedKey = marketingSelectionKey(defaults.date, defaults.slotKey);
        ({ inventory: renderInventoryTab, review: renderReviewTab, pricing: renderPricingTab, marketing: renderMarketingTab, orders: renderOrdersTab })[tab]();
      }, tab);
      check(`${width}: Admin ${tab} editable fields bounded`, await page.locator('main input:not([type=checkbox]), main select').evaluateAll(els => els.length > 0 && els.every(el => getComputedStyle(el).borderColor === 'rgb(117, 135, 124)')));
      await page.screenshot({ path: path.join(output, `admin-${tab}-${width}.png`), fullPage: true });
    }
    // Exercise actual shipped route bootstraps against exclusively local API fixtures.
    for (const route of ['/', '/carrito', '/checkout', '/pedido/VM-PRUEBA-LOCAL?access=local-only', '/admin']) {
      await page.goto(`http://127.0.0.1:${server.address().port}${route}`);
      const required = route === '/' ? '#catalog-search' : route === '/carrito' ? '[data-cart-quantity]' : route === '/checkout' ? '#checkout-form' : route === '/admin' ? '#admin-login' : '#receipt-form .file-picker';
      await page.locator(required).waitFor();
      check(`${width}: shipped ${route} renders`, await page.locator(required).isVisible());
      if (route === '/') {
        await page.getByText('Más filtros', { exact: true }).click();
        check(`${width}: catalog dropdown field surface`, await page.locator('[data-sort-select]').evaluate(el => getComputedStyle(el).borderColor === 'rgb(117, 135, 124)'));
      }
      if (route === '/checkout') {
        check(`${width}: buyer email label Spanish`, await page.getByLabel('Correo electrónico').count() === 1);
        await page.getByRole('button', { name: /Crear pedido/ }).click();
        check(`${width}: checkout required field Spanish`, await page.locator('input[name=name]').evaluate(el => el.validationMessage === 'Completa este campo.'));
      }
      if (route.startsWith('/pedido/')) {
        check(`${width}: pickup selector visible`, await page.locator('select[name=slotKey]').isVisible());
        await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
        check(`${width}: cancellation confirmation Spanish`, await page.getByRole('dialog').isVisible());
        await page.getByRole('button', { name: /mantener pedido/i }).click();
      }
      await page.screenshot({ path: path.join(output, `route-${route === '/' ? 'catalog' : route.split('/')[1]}-${width}.png`), fullPage: true });
    }
    await page.close();
  }
  await writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ baseline, checks, passed: checks.length }, null, 2));
  console.log(`${checks.length} browser assertions passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
