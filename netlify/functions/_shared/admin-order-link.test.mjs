import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createAdminOrderLinkHandler } from '../admin-order-link.mjs';
import { hashAccessToken } from './commerce.mjs';
import { orderAccessToken } from './order-access.mjs';

test('Admin copies only the existing verified private link, with no writes or public access', async () => {
  const original = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'synthetic-admin';
  try {
    const id = 'VM-SYNTHETIC', session = 'synthetic-session';
    const access = orderAccessToken(session, id);
    let row = { session_id: session, order_snapshot: { accessTokenHash: hashAccessToken(access) } };
    const calls = [];
    const handler = createAdminOrderLinkHandler({ query: async (sql, params) => {
      calls.push({ sql, params });
      assert.match(sql, /^SELECT /);
      return { rows: row ? [row] : [] };
    } });
    const request = (token = 'synthetic-admin', method = 'GET') => new Request(`https://example.com/api/admin/order-link?id=${id}`,
      { method, headers: { 'x-admin-token': token } });
    assert.equal((await handler(request(''))).status, 401);
    assert.equal((await handler(request('wrong'))).status, 401);
    assert.equal((await handler(request(undefined, 'POST'))).status, 405);
    assert.equal(calls.length, 0);
    const response = await handler(request());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: true, privateOrderLink: `https://example.com/pedido/${id}?access=${access}` });
    row.order_snapshot.accessTokenHash = hashAccessToken('different-existing-access');
    assert.equal((await handler(request())).status, 409);
    row = null;
    assert.equal((await handler(request())).status, 404);
  } finally {
    if (original === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = original;
  }
});

for (const mobile of [false, true]) test(`Admin clipboard action copies the link only on request (${mobile ? 'mobile' : 'writeText'})`, async () => {
  const source = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');
  const copied = [], requests = [];
  const context = { URLSearchParams, Headers, Blob, console,
    window: { addEventListener() {} },
    document: { readyState: 'loading', addEventListener() {} },
    navigator: { clipboard: mobile ? { write: async items => {
      copied.push(await (await items[0].data['text/plain']).text());
    } } : { writeText: async text => copied.push(text) } },
    ClipboardItem: mobile ? class { constructor(data) { this.data = data; } } : undefined,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ privateOrderLink: 'https://example.com/pedido/VM-SYNTHETIC?access=existing' }) };
    },
  };
  runInNewContext(`${source}\n;ADMIN_STATE.token='synthetic-admin'; globalThis.copyLink=copyAdminPrivateOrderLink;`, context);
  assert.equal(requests.length, 0);
  const button = { disabled: false }, status = { textContent: '' };
  await context.copyLink('VM-SYNTHETIC', button, status);
  assert.deepEqual(copied, ['https://example.com/pedido/VM-SYNTHETIC?access=existing']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.get('x-admin-token'), 'synthetic-admin');
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /copiado/);
});
