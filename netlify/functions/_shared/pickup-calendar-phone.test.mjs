import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const context = { window: { addEventListener() {} } };
runInNewContext(await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8') + '\n' +
  await readFile(new URL('../../../js/admin-retiros.js', import.meta.url), 'utf8') +
  '\nglobalThis.api = { normalize: retiroWhatsAppNumber, card: retiroAppointmentCard };', context);

for (const phone of ['0981123456', '0981 123 456', '(0981) 123-456', '+595981123456',
  '+595 (981) 123-456', '595 981 123 456', '00595 981 123 456']) {
  test(`Retiros WhatsApp normalizes ${phone} without rewriting the displayed number`, () => {
    assert.equal(context.api.normalize(phone), '595981123456');
    const card = context.api.card({ slotKey: '2026-12-01|09:00-10:00', orderId: 'VM-SYNTHETIC', buyerPhone: phone });
    assert.ok(card.includes(`Teléfono: ${phone}`));
    assert.match(card, /href="https:\/\/wa.me\/595981123456"/);
  });
}
for (const phone of ['981123456', '0981123', '+595 0981 123456', '0981123456789', '595000123456',
  '0981 123456 ext 2', '0981123456 / 0982234567', '++595981123456', '+00000000000', '021123456', '', '<0981123456>']) {
  test(`Retiros keeps uncertain phone ${JSON.stringify(phone)} visible without an unusable link`, () => {
    assert.equal(context.api.normalize(phone), '');
    const card = context.api.card({ slotKey: '2026-12-01|09:00-10:00', orderId: 'VM-SYNTHETIC', buyerPhone: phone });
    assert.doesNotMatch(card, /wa.me\//);
    assert.ok(card.includes('Teléfono: '));
    if (phone) assert.ok(card.includes(phone.replaceAll('<', '&lt;').replaceAll('>', '&gt;')));
    assert.match(card, /Abrir pedido/);
  });
}
test('explicit international formats retain digits-only links without guessing a country', () => {
  assert.equal(context.api.normalize('+1 (202) 555-0123'), '12025550123');
  assert.equal(context.api.normalize('0012025550123'), '12025550123');
  assert.equal(context.api.normalize('2025550123'), '');
});
