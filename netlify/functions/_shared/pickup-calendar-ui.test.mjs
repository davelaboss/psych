import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { chromium } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { createPickupCalendarHandler } from '../admin-pickup-calendar.mjs';
import { setInventoryDatabaseClientForTests } from './inventory-database.mjs';
import { listUpcomingPickups, pickupFulfillments } from './pickup.mjs';

const root = new URL('../../../', import.meta.url);
const assets = Object.fromEntries(await Promise.all(['js/admin.js', 'js/admin-retiros.js', 'css/site.css', 'css/admin-retiros.css']
  .map(async file => [`/${file}`, await readFile(new URL(file, root), 'utf8')])));
let browser, db;
const originalToken = process.env.ADMIN_TOKEN;
test.before(async () => {
  process.env.ADMIN_TOKEN = 'synthetic-owner';
  browser = await chromium.launch({ headless: true }); db = new PGlite();
  for (const name of ['20261001_operational_inventory', '20261005_pickup_notifications', '20261006_notification_recipients',
    '20261010_pickup_fulfillment_parts', '20261102_pickup_blackouts']) {
    await db.exec(await readFile(new URL(`../../database/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  setInventoryDatabaseClientForTests({ pool: { query: (...args) => db.query(...args),
    connect: async () => ({ query: (...args) => db.query(...args), release() {} }) } });
});
test.after(async () => {
  await browser?.close(); await db?.close(); setInventoryDatabaseClientForTests(undefined);
  if (originalToken === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = originalToken;
});

async function seed() {
  await db.exec('TRUNCATE cart_sessions,pickup_blackouts,pickup_windows CASCADE');
  const orders = [];
  for (const [id, name, time] of [['VM-DEMO-001', 'Ana (demostración)', '09:00-10:00'], ['VM-DEMO-002', 'Bruno (demostración)', '08:00-12:00']]) {
    const session = randomUUID();
    const order = { id, createdAt: Date.parse('2026-11-01T12:00:00Z'), status: 'PAID_IN_FULL', buyer: { name, phone: '+595 000 123456', email: '' },
      totals: { totalPYG: 100000, dueNowPYG: 100000, futureBalancePYG: 0 },
      items: [{ productId: 'synthetic', itemNumber: 381, title: 'Artículo de demostración', quantity: 1, saleMode: 'IMMEDIATE', unitPricePYG: 100000, dueNowPYG: 100000 }],
      payments: [{ id: 'paid', type: 'FULL', amountPYG: 100000, amountSource: 'ADMIN_VERIFIED', verifiedBy: 'ADMIN', verificationStatus: 'CONFIRMED' }], paymentAdjustments: [] };
    orders.push(order);
    await db.query('INSERT INTO cart_sessions(session_id) VALUES($1)', [session]);
    await db.query(`INSERT INTO checkout_attempts(session_id,checkout_id,order_id,order_snapshot,cart_generation,request_fingerprint)
      VALUES($1,$2,$3,$4,0,'synthetic')`, [session, randomUUID(), id, JSON.stringify(order)]);
    await db.query('INSERT INTO pickup_windows(slot_key) VALUES($1)', [`2026-12-01|${time}`]);
    await db.query(`INSERT INTO pickup_appointments(order_id,timing_key,slot_key,status,changed_by)
      VALUES($1,'IMMEDIATE',$2,'SCHEDULED','ADMIN')`, [id, `2026-12-01|${time}`]);
  }
  return orders;
}

for (const mobile of [false, true]) test(`Retiros ${mobile ? 'mobile' : 'desktop'}: navigate, review actual conflicts, save/edit/remove and open order`, async () => {
  const orders = await seed();
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-01T12:00:00Z') });
  const handler = createPickupCalendarHandler();
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()); requests.push({ path: url.pathname, method: req.method() });
    if (url.pathname === '/api/admin/pickup-calendar') {
      const response = await handler(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.method() === 'POST' ? req.postData() : undefined }));
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    }
    if (url.pathname === '/api/admin/pickup') {
      const result = url.searchParams.has('id') ? { fulfillments: await pickupFulfillments(orders.find(o => o.id === url.searchParams.get('id'))) }
        : { upcoming: await listUpcomingPickups({ client: db, now: new Date('2026-11-01T12:00:00Z') }) };
      return route.fulfill({ json: result });
    }
    if (url.pathname === '/api/admin/orders') return route.fulfill({ json: { orders } });
    if (url.pathname === '/api/admin/order') return route.fulfill({ json: { order: orders.find(o => o.id === url.searchParams.get('id')) } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { entries: [], batches: [], groups: [] } });
    if (assets[url.pathname]) return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', body: assets[url.pathname] });
    if (url.pathname === '/admin') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/admin-retiros.css"></head><body><main></main><script src="/js/admin.js"></script><script src="/js/admin-retiros.js"></script></body></html>' });
    return route.abort(); // The demonstration cannot contact any live service.
  });
  await page.goto('http://retiros.test/admin');
  await page.evaluate(orders => {
    ADMIN_STATE.token = 'synthetic-owner'; ADMIN_STATE.activeTab = 'retiros'; ADMIN_STATE.orders = orders;
    ADMIN_STATE.stats = { review: 0, awaitingPayment: 0, totalProducts: 0 }; renderAdminShell();
  }, orders);
  await page.locator('[data-retiro-date="2026-11-01"]').waitFor();
  assert.deepEqual(await page.locator('[data-admin-tab]').evaluateAll(buttons => buttons.map(b => b.dataset.adminTab)),
    ['overview', 'retiros', 'orders', 'buyer-sheets', 'inventory', 'pricing', 'batches', 'marketing', 'review']);
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await page.locator('[data-retiro-date="2026-10-01"]').waitFor();
  await page.getByRole('button', { name: 'Mes siguiente' }).click();
  await page.locator('[data-retiro-date="2026-11-01"]').waitFor();
  await page.getByRole('button', { name: 'Mes siguiente' }).click();
  await page.locator('[data-retiro-date="2026-12-01"]').waitFor();
  await page.getByText('Calendario actualizado.', { exact: false }).waitFor();
  const form = page.locator('[data-retiro-block-form]');
  await form.locator('[name="start"]').fill('09:30'); await form.locator('[name="end"]').fill('10:30');
  await form.locator('[name="reason"]').fill('Compromiso familiar (ejemplo privado)');
  await form.getByRole('button', { name: 'Revisar bloqueo', exact: true }).click();
  const review = page.locator('[data-retiro-review]');
  await review.getByText('Compradores afectados', { exact: true }).waitFor();
  assert.equal(await review.locator('.retiro-appointment').count(), 2);
  assert.equal(await review.getByRole('link', { name: 'WhatsApp' }).count(), 2);
  assert.equal(await review.getByRole('button', { name: 'Abrir pedido' }).count(), 2);
  assert.match(await review.innerText(), /Ana.*|Bruno/); assert.match(await review.innerText(), /Item 381|Items 381/);
  assert.equal((await db.query('SELECT * FROM pickup_blackouts')).rows.length, 0);
  const output = process.env.RETIROS_DEMO_OUTPUT_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    await page.locator('.admin-shell-v2').screenshot({ path: path.join(output, `retiros-${mobile ? 'mobile' : 'desktop'}-review.png`) });
    await page.locator('.admin-tabs-v2').screenshot({ path: path.join(output, `retiros-${mobile ? 'mobile' : 'desktop'}-navigation.png`) });
  }
  await review.locator('[data-retiro-confirm]').click();
  await page.locator('.retiro-block').waitFor();
  assert.equal(await page.locator('[data-retiros-day] .needs-reschedule').count(), 2);
  assert.equal((await db.query("SELECT * FROM pickup_appointments WHERE status='SCHEDULED'")).rows.length, 2);
  assert.ok(await page.locator('[data-retiro-date="2026-12-01"]').getAttribute('aria-label').then(t => t.includes('1 bloqueos')));
  if (output) await page.locator('.admin-shell-v2').screenshot({ path: path.join(output, `retiros-${mobile ? 'mobile' : 'desktop'}-saved.png`) });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page must not overflow horizontally');
  assert.ok(await page.locator('.retiro-date').evaluateAll(days => days.every(day => day.scrollWidth <= day.clientWidth)), 'calendar labels must fit within their day');
  await page.locator('[data-retiro-edit]').click();
  await form.locator('[name="allDay"]').check();
  await form.getByRole('button', { name: 'Revisar bloqueo', exact: true }).click();
  await review.locator('[data-retiro-confirm]').click();
  await page.getByText('00:00–24:00 · Bloqueo del propietario', { exact: true }).waitFor();
  await page.locator('[data-retiro-edit]').click();
  await form.getByRole('button', { name: 'Quitar bloqueo', exact: true }).click();
  await page.locator('[data-retiro-remove-confirm]').click();
  await page.waitForFunction(() => !document.querySelector('.retiro-block'));
  assert.equal((await db.query('SELECT * FROM pickup_blackouts')).rows.length, 0);
  await page.locator('[data-retiros-day] [data-retiro-order="VM-DEMO-001"]').click();
  await page.locator('[data-admin-detail="VM-DEMO-001"] #admin-pickup-editor').waitFor();
  assert.ok(requests.some(r => r.path === '/api/admin/order'));
  assert.equal(await page.locator('#admin-upcoming-pickups').count(), 0, 'upcoming list moved out of Pedidos');
  assert.deepEqual(errors, []);
  await page.close();
});
