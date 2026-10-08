import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicOrder } from './commerce.mjs';

test('public order projection excludes reconciliation notes and internal metadata', () => {
  const order = {
    id: 'VM-PUBLIC',
    createdAt: 1,
    updatedAt: 2,
    status: 'DEPOSIT_CONFIRMED',
    buyer: { name: 'María', phone: '+595', email: 'maria@example.com' },
    items: [{ saleMode: 'DELAYED' }],
    totals: { totalPYG: 250_000, dueNowPYG: 62_500, futureBalancePYG: 187_500 },
    payments: [
      {
        id: 'legacy-initial',
        type: 'DEPOSIT',
        amountPYG: 65_000,
        amountSource: 'LEGACY_RECONCILED',
        verifiedBy: 'ADMIN',
        reconciledBy: 'ADMIN',
        reconciledAt: 2,
        legacyAssumedAmountPYG: 62_500,
        submittedAt: 1,
        paymentMethod: 'BANK_TRANSFER',
        verificationStatus: 'CONFIRMED',
        confirmedAt: 2,
        receipt: {
          storageKey: 'secret/key',
          fileName: 'receipt.pdf',
          contentType: 'application/pdf',
          uploadedAt: 1,
        },
      },
      {
        id: 'voided-payment',
        type: 'FINAL',
        amountPYG: 185_000,
        verificationStatus: 'CONFIRMED',
        confirmedAt: 2,
        voidedAt: 3,
        voidedBy: 'ADMIN',
        voidReason: 'DUPLICATE_LEGACY_PAYMENT',
        voidNoteId: 'void-note-1',
        receipt: {
          storageKey: 'secret/voided-key',
          fileName: 'duplicate.pdf',
          contentType: 'application/pdf',
          uploadedAt: 1,
        },
      },
      {
        id: 'pending-payment',
        type: 'FINAL',
        amountPYG: null,
        verificationStatus: 'PENDING',
        receipt: {
          storageKey: 'secret/pending-key',
          fileName: 'pending.pdf',
          contentType: 'application/pdf',
        },
      },
    ],
    paymentNotes: [
      {
        id: 'note-1',
        kind: 'LEGACY_RECONCILIATION',
        text: 'Internal reconciliation note',
        relatedPaymentId: 'legacy-initial',
        createdAt: 2,
        createdBy: 'ADMIN',
      },
      {
        id: 'void-note-1',
        kind: 'LEGACY_PAYMENT_VOID',
        text: 'Internal duplicate-payment note',
        relatedPaymentId: 'voided-payment',
        createdAt: 3,
        createdBy: 'ADMIN',
      },
    ],
    paymentAdjustments: [{
      id: 'adjustment-secret-id',
      kind: 'POST_SALE_PRICE_ADJUSTMENT',
      amountPYG: 30_000,
      createdAt: 4,
      createdBy: 'ADMIN',
      internalNote: 'Private post-sale adjustment note',
    }],
    internalAudit: 'secret audit value',
    pickup: null,
  };

  const projected = publicOrder(order);
  const serialized = JSON.stringify(projected);
  assert.equal('paymentNotes' in projected, false);
  assert.equal('paymentAdjustments' in projected, false);
  assert.equal(projected.grossOrderTotalPYG, 250_000);
  assert.equal(projected.paidAmountPYG, 65_000);
  assert.equal(projected.refundedAmountPYG, 30_000);
  assert.equal(projected.adjustedOrderTotalPYG, 220_000);
  assert.equal(projected.netReceivedPYG, 35_000);
  assert.equal(projected.remainingBalancePYG, 185_000);
  assert.deepEqual(projected.payments, [{
    id: 'legacy-initial',
    amountPYG: 65_000,
    confirmedAt: 2,
  }]);
  assert.equal(serialized.includes('Internal reconciliation note'), false);
  assert.equal(serialized.includes('Internal duplicate-payment note'), false);
  assert.equal(serialized.includes('Private post-sale adjustment note'), false);
  assert.equal(serialized.includes('adjustment-secret-id'), false);
  assert.equal(serialized.includes('POST_SALE_PRICE_ADJUSTMENT'), false);
  assert.equal(serialized.includes('createdBy'), false);
  assert.equal(serialized.includes('LEGACY_RECONCILED'), false);
  assert.equal(serialized.includes('DUPLICATE_LEGACY_PAYMENT'), false);
  assert.equal(serialized.includes('voided-payment'), false);
  assert.equal(serialized.includes('pending-payment'), false);
  assert.equal(serialized.includes('voidedAt'), false);
  assert.equal(serialized.includes('voidNoteId'), false);
  assert.equal(serialized.includes('legacyAssumedAmountPYG'), false);
  assert.equal(serialized.includes('verifiedBy'), false);
  assert.equal(serialized.includes('reconciledBy'), false);
  assert.equal(serialized.includes('secret audit value'), false);
  assert.equal(serialized.includes('secret/key'), false);
});
