import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const customer = await readFile(new URL('../../../js/checkout.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');
const oldSlot = '2026-11-02|08:00-12:00';
const newSlot = '2026-11-03|13:00-14:00';
const part = () => ({ timingKey: 'IMMEDIATE', timingLabel: 'Retiro inmediato', eligible: true,
  items: [{ itemNumber: 381, quantity: 2 }],
  appointment: { status: 'SCHEDULED', slotKey: oldSlot, revision: 4 },
  slots: [{ key: newSlot, remaining: 1 }, { key: '2026-11-03|14:00-15:00', remaining: 0 }] });

function scenario(kind, { fail = false, data = part() } = {}) {
  const calls = [], listeners = new Map();
  const button = { disabled: false }, select = { disabled: false };
  const error = { hidden: true, textContent: '' };
  const form = { dataset: { pickupTimingKey: 'IMMEDIATE' }, value: newSlot,
    querySelector: selector => selector.includes('button') ? button : error,
    addEventListener: (type, listener) => listeners.set(type, listener) };
  const partElement = { dataset: { adminPickupPart: 'IMMEDIATE' },
    querySelectorAll: () => [button, select],
    querySelector: selector => selector === 'form' ? form : selector.includes('error') ? error : null };
  const target = { innerHTML: '', querySelectorAll: () => kind === 'admin' ? [partElement] : [form] };
  const upcoming = { innerHTML: '' };
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const context = {
    Headers, URLSearchParams, console, Error, TypeError, SyntaxError,
    escapeHtml: escape, formatPYG: String,
    window: { addEventListener() {} },
    document: { readyState: 'loading', addEventListener() {},
      getElementById: id => id === 'admin-upcoming-pickups' ? upcoming : target },
    FormData: class { constructor(form) { this.form = form; } get() { return this.form.value; } },
    fetch: async (url, options = {}) => {
      const payload = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, payload });
      if (payload && fail) return { ok: false, status: 409, headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Este horario ya está completo. Elegí otro.' }) };
      if (payload) data = { ...data, appointment: { status: 'SCHEDULED', slotKey: newSlot, revision: 5 } };
      const result = url === '/api/admin/pickup' && !payload
        ? { upcoming: [{ slotKey: data.appointment.slotKey, orderId: 'VM-TEST', buyer: '<Synthetic>',
          timingLabel: 'Retiro inmediato', itemNumbers: [381] }] }
        : { fulfillments: [data] };
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => result };
    },
  };
  runInNewContext(`${kind === 'admin' ? admin : customer}\n;globalThis.api = {
    setup: ${kind === 'admin' ? 'setupAdminPickup' : 'setupPickupScheduler'}
  };${kind === 'admin' ? "ADMIN_STATE.token = 'synthetic';" : ''}`, context);
  return { ...context.api, calls, target, upcoming, button, select, error,
    async submit() {
      await listeners.get('submit')({ preventDefault() {}, currentTarget: form });
      await new Promise(setImmediate);
    } };
}

for (const kind of ['customer', 'admin']) {
  test(`${kind} shows the legacy appointment and available hourly options without writing on view`, async () => {
    const s = scenario(kind);
    await s.setup({ id: 'VM-TEST' }, 'synthetic-access');
    assert.match(s.target.innerHTML, /2026-11-02 · 08:00-12:00/);
    assert.match(s.target.innerHTML, /Hora de Paraguay.*turnos de una hora/);
    assert.match(s.target.innerHTML, /2026-11-03 · 13:00-14:00.*1 lugar/);
    assert.doesNotMatch(s.target.innerHTML, /value="2026-11-03\|14:00-15:00"/);
    assert.doesNotMatch(s.target.innerHTML, /value="2026-11-02\|08:00-12:00"/);
    assert.ok(s.calls.every(c => c.payload === null));
  });

  test(`${kind} retains the confirmed appointment after a failed replacement`, async () => {
    const s = scenario(kind, { fail: true });
    await s.setup({ id: 'VM-TEST' }, 'synthetic-access');
    await s.submit();
    assert.match(s.target.innerHTML, /2026-11-02 · 08:00-12:00/);
    assert.equal(s.error.hidden, false);
    assert.match(s.error.textContent, /completo/);
    assert.equal(s.button.disabled, false);
    assert.equal(s.calls.filter(c => c.payload).length, 1);
    assert.equal(s.calls.filter(c => !c.payload).length, 1);
  });

  test(`${kind} commits the selected timing key, then refreshes the persisted appointment`, async () => {
    const s = scenario(kind);
    await s.setup({ id: 'VM-TEST' }, 'synthetic-access');
    await Promise.all([s.submit(), s.submit()]);
    const posts = s.calls.filter(c => c.payload);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].payload.orderId, 'VM-TEST');
    assert.equal(posts[0].payload.timingKey, 'IMMEDIATE');
    assert.equal(posts[0].payload.slotKey, newSlot);
    if (kind === 'customer') assert.equal(posts[0].payload.access, 'synthetic-access');
    else {
      assert.match(s.upcoming.innerHTML, /2026-11-03 · 13:00-14:00/);
      assert.match(s.upcoming.innerHTML, /&lt;Synthetic&gt;/);
    }
    assert.match(s.target.innerHTML, /2026-11-03 · 13:00-14:00/);
  });

  test(`${kind} retains a legacy appointment when payment eligibility no longer offers slots`, async () => {
    const s = scenario(kind, { data: { ...part(), eligible: false, slots: [] } });
    await s.setup({ id: 'VM-TEST' }, 'synthetic-access');
    assert.match(s.target.innerHTML, /2026-11-02 · 08:00-12:00/);
    assert.doesNotMatch(s.target.innerHTML, /<form/);
    assert.ok(s.calls.every(c => !c.payload));
  });
}
