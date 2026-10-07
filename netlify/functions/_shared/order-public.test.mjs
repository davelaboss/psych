import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicOrder } from './commerce.mjs';

test('public order projection excludes all internal payment metadata and notes', () => {
  const order = {
    id: 'VM-PUBLIC',
    createdAt: 1,
    updatedAt: 2,
    status: 'DEPOSIT_CONFIRMED',
    buyer: { name: 'María', phone: '+595', email: 'maria@example.com' },
    items: [{ saleMode: 'DELAYED' }],
    totals: { totalPYG: 2_000_000, dueNowPYG: 500_000, futureBalancePYG: 1_500_000 },
    payments: [{
      id: 'p1', type: 'DEPOSIT', amountPYG: 495_000, amountSource: 'ADMIN_VERIFIED',
      verifiedBy: 'ADMIN', verificationStatus: 'CONFIRMED', confirmedAt: 2,
      receipt: { storageKey: 'secret/key', fileName: 'receipt.pdf', contentType: 'application/pdf' },
      internalAudit: 'secret',
    }],
    paymentNotes: [{ id: 'n1', kind: 'EXCEPTION', text: 'Internal only', createdAt: 2, createdBy: 'ADMIN' }],
    pickup: null,
  };
  const projected = publicOrder(order);
  assert.equal('paymentNotes' in projected, false);
  assert.deepEqual(projected.payments, [{ id: 'p1', amountPYG: 495_000, confirmedAt: 2 }]);
  assert.equal(JSON.stringify(projected).includes('Internal only'), false);
  assert.equal(JSON.stringify(projected).includes('secret/key'), false);
  assert.equal(JSON.stringify(projected).includes('ADMIN_VERIFIED'), false);
});
