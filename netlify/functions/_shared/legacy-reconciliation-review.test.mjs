import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  LEGACY_RECONCILIATION_REVIEW_ALLOWLIST,
  legacyReviewContextEntries,
  legacyReviewEntriesForOrder,
  legacyReviewEntry,
  legacyReviewRequiresReceiptValidation,
  legacyReviewSection,
  orderedLegacyReviewEntries,
  paymentIsCompletedForReview,
  proposedLegacyReviewNote,
  validateAllowlistedLegacyContext,
  validateAllowlistedLegacyOrder,
  validateLegacyReviewReceipt,
} from './legacy-reconciliation-review.mjs';
import { reconcileLegacyPayment, withPaymentState } from './order-payments.mjs';

const endpoint = await readFile(new URL('../admin-legacy-reconciliation-review.mjs', import.meta.url), 'utf8');
const admin = await readFile(new URL('../../../js/admin.js', import.meta.url), 'utf8');

function reviewedPayment(entry, overrides = {}) {
  return {
    id: entry.paymentId,
    type: entry.paymentType,
    amountPYG: entry.amountPYG,
    ...(entry.expectedSource === 'ABSENT' ? {} : { amountSource: entry.expectedSource }),
    receipt: { storageKey: entry.storageKey, fileName: 'receipt.png', contentType: 'image/png' },
    paymentMethod: 'BANK_TRANSFER',
    verificationStatus: 'CONFIRMED',
    confirmedAt: entry.confirmedAt,
    ...overrides,
  };
}

function reviewedOrder(entry, overrides = {}) {
  return withPaymentState({
    id: entry.orderId,
    status: entry.orderStatus,
    buyer: { name: entry.customer },
    totals: {
      totalPYG: entry.orderTotalPYG,
      dueNowPYG: entry.dueNowPYG,
    },
    items: [{ productId: 'reviewed-item', saleMode: entry.orderStatus === 'PAID_IN_FULL' ? 'DELAYED' : 'IMMEDIATE' }],
    payments: legacyReviewEntriesForOrder(entry.orderId).map(reviewedPayment),
    paymentNotes: [],
    paymentAdjustments: entry.adjustments || [],
    ...overrides,
  });
}

function completedPayment(entry) {
  return reviewedPayment(entry, {
    amountSource: 'LEGACY_RECONCILED',
    legacyAssumedAmountPYG: entry.amountPYG,
    verifiedBy: 'ADMIN',
    reconciledBy: 'ADMIN',
    reconciledAt: entry.confirmedAt + 1000,
  });
}

test('review allowlist contains exactly 51 payments with 9 priorities and 5 special cases', () => {
  assert.equal(LEGACY_RECONCILIATION_REVIEW_ALLOWLIST.length, 51);
  assert.equal(LEGACY_RECONCILIATION_REVIEW_ALLOWLIST.filter(entry => entry.priority).length, 9);
  assert.equal(LEGACY_RECONCILIATION_REVIEW_ALLOWLIST.filter(entry => entry.specialKind).length, 5);
  assert.equal(new Set(LEGACY_RECONCILIATION_REVIEW_ALLOWLIST.map(entry =>
    `${entry.orderId}|${entry.paymentId}`)).size, 51);
  assert.equal(LEGACY_RECONCILIATION_REVIEW_ALLOWLIST.every(entry =>
    /^[a-f0-9]{64}$/.test(entry.receiptSha256) && entry.storageKey.startsWith(`${entry.orderId}/`)), true);
});

test('priority entries sort first, ordinary entries next, and special cases last', () => {
  const sections = orderedLegacyReviewEntries().map(legacyReviewSection);
  assert.deepEqual(sections.slice(0, 9), Array(9).fill('PRIORITY'));
  assert.deepEqual(sections.slice(-5), Array(5).fill('SPECIAL'));
  assert.equal(sections.filter(section => section === 'ORDINARY').length, 37);
});

test('all five special cases carry the exact owner-confirmed amounts and notes', () => {
  const nadia = legacyReviewEntry('VM-2026-042A512D', 'd8b81b2f-0f43-4d6c-b97e-2fd6b23a6f06');
  const virginiaFinal = legacyReviewEntry('VM-2026-584788D3', '72531bdb-30f3-492c-a63f-c3ddb94c0af3');
  const virginiaOther = legacyReviewEntry('VM-2026-3B2771C4', 'acb02908-1857-4dcf-a4fb-35de2f18e172');
  const debbey = legacyReviewEntry('VM-2026-867B8840', 'a3d082d5-2543-47ce-9352-426af313a008');
  const esilda = legacyReviewEntry('VM-2026-E00AA2E0', 'legacy-initial');
  assert.deepEqual([nadia.amountPYG, virginiaFinal.amountPYG, virginiaOther.amountPYG,
    debbey.amountPYG, esilda.amountPYG], [238_000, 273_750, 63_000, 140_000, 60_000]);
  assert.match(proposedLegacyReviewNote(nadia), /efectivo por Gs\. 238\.000/);
  assert.match(proposedLegacyReviewNote(virginiaFinal), /Gs\. 273\.750 corresponden a este pedido/);
  assert.match(proposedLegacyReviewNote(virginiaOther), /Gs\. 63\.000 corresponden a este pedido/);
  assert.match(proposedLegacyReviewNote(debbey), /Zelle por USD 50/);
  assert.match(proposedLegacyReviewNote(esilda), /c739b410-2f15-4d18-9f46-b7f144171104/);
  assert.equal(legacyReviewRequiresReceiptValidation(nadia), false);
  assert.equal(legacyReviewRequiresReceiptValidation(virginiaFinal), true);
  assert.equal(legacyReviewRequiresReceiptValidation(debbey), true);
});

test('ordinary reviewed state passes and every material state change fails closed', () => {
  const entry = legacyReviewEntry('VM-2026-1CE93F99', 'legacy-initial');
  assert.doesNotThrow(() => validateAllowlistedLegacyOrder(reviewedOrder(entry), entry));
  const mutations = [
    order => ({ ...order, status: 'PAYMENT_CONFIRMED' }),
    order => ({ ...order, buyer: { ...order.buyer, name: 'Changed customer' } }),
    order => ({ ...order, paidAmountPYG: order.paidAmountPYG + 1 }),
    order => ({ ...order, remainingBalancePYG: order.remainingBalancePYG + 1 }),
    order => ({ ...order, payments: order.payments.map(payment => ({ ...payment, amountPYG: payment.amountPYG + 1 })) }),
    order => ({ ...order, payments: order.payments.map(payment => ({ ...payment, amountSource: 'ADMIN_VERIFIED' })) }),
    order => ({ ...order, payments: order.payments.map(payment => ({ ...payment, verificationStatus: 'PENDING' })) }),
    order => ({ ...order, payments: order.payments.map(payment => ({ ...payment, paymentMethod: 'CASH' })) }),
    order => ({ ...order, payments: order.payments.map(payment => ({ ...payment, voidedAt: 1 })) }),
    order => ({ ...order, payments: order.payments.map(payment => ({ ...payment,
      receipt: { ...payment.receipt, storageKey: 'changed/key' } })) }),
    order => ({ ...order, payments: [...order.payments, reviewedPayment(entry, { id: 'new-payment' })] }),
    order => ({ ...order, paymentAdjustments: [{ id: 'new-adjustment', kind: 'POST_SALE_PRICE_ADJUSTMENT', amountPYG: 1 }] }),
  ];
  for (const mutate of mutations) {
    assert.throws(() => validateAllowlistedLegacyOrder(mutate(reviewedOrder(entry)), entry), /estado cambió/i);
  }
});

test('completed sibling payments are accepted while the selected payment must remain eligible', () => {
  const target = legacyReviewEntry('VM-2026-584788D3', '72531bdb-30f3-492c-a63f-c3ddb94c0af3');
  const sibling = legacyReviewEntry('VM-2026-584788D3', '8ae5ce77-b8b1-4642-835c-2efc92316d7a');
  const order = reviewedOrder(target, {
    payments: [completedPayment(sibling), reviewedPayment(target)],
  });
  assert.doesNotThrow(() => validateAllowlistedLegacyOrder(order, target));
  assert.equal(paymentIsCompletedForReview(order.payments[0], sibling), true);
  assert.throws(() => validateAllowlistedLegacyOrder({
    ...order,
    payments: [completedPayment(sibling), completedPayment(target)],
  }, target), /estado cambió/i);
});

test('Virginia split requires both orders and allows the counterpart to be completed sequentially', () => {
  const target = legacyReviewEntry('VM-2026-584788D3', '72531bdb-30f3-492c-a63f-c3ddb94c0af3');
  const related = legacyReviewEntry('VM-2026-3B2771C4', 'acb02908-1857-4dcf-a4fb-35de2f18e172');
  const orders = new Map([
    [target.orderId, reviewedOrder(target)],
    [related.orderId, reviewedOrder(related)],
  ]);
  assert.equal(legacyReviewContextEntries(target).length, 2);
  assert.doesNotThrow(() => validateAllowlistedLegacyContext(orders, target));
  orders.delete(related.orderId);
  assert.throws(() => validateAllowlistedLegacyContext(orders, target), /estado cambió/i);
  orders.set(related.orderId, reviewedOrder(related, { payments: [completedPayment(related)] }));
  assert.doesNotThrow(() => validateAllowlistedLegacyContext(orders, target));
});

test('receipt validation requires exact decoded-byte SHA-256', () => {
  const encoded = Buffer.from('reviewed receipt bytes').toString('base64');
  const entry = { receiptSha256: createHash('sha256').update('reviewed receipt bytes').digest('hex') };
  assert.equal(validateLegacyReviewReceipt(entry, encoded), true);
  assert.throws(() => validateLegacyReviewReceipt(entry, Buffer.from('changed').toString('base64')),
    /estado cambió/i);
  assert.throws(() => validateLegacyReviewReceipt(entry, null), /estado cambió/i);
});

test('Esilda reconciliation preserves the separate 30,000 adjustment and all net totals', () => {
  const entry = legacyReviewEntry('VM-2026-E00AA2E0', 'legacy-initial');
  const before = reviewedOrder(entry);
  validateAllowlistedLegacyOrder(before, entry);
  const after = reconcileLegacyPayment(before, {
    paymentId: entry.paymentId,
    reconciledAmountPYG: entry.amountPYG,
    basis: 'ACTUAL_VERIFIED',
    internalNote: proposedLegacyReviewNote(entry),
    timestamp: entry.confirmedAt + 10_000,
    noteId: 'esilda-reconciliation-note',
  });
  assert.deepEqual(after.paymentAdjustments, before.paymentAdjustments);
  assert.equal(after.refundedAmountPYG, 30_000);
  assert.equal(after.adjustedOrderTotalPYG, 30_000);
  assert.equal(after.netReceivedPYG, 30_000);
  assert.equal(after.remainingBalancePYG, 0);
  assert.throws(() => validateAllowlistedLegacyOrder({
    ...before,
    paymentAdjustments: before.paymentAdjustments.map(adjustment => ({
      ...adjustment,
      internalNote: 'changed',
    })),
  }, entry), /estado cambió/i);
});

test('admin-only endpoint derives amount, basis, and note server-side', () => {
  assert.match(endpoint, /adminAuthorized\(request\)/);
  assert.match(endpoint, /allowedPostFields = new Set\(\['orderId', 'paymentId', 'ownerConfirmed'\]\)/);
  assert.match(endpoint, /ownerConfirmed !== true/);
  assert.match(endpoint, /validateLegacyReviewReceipt/);
  assert.match(endpoint, /filter\(legacyReviewRequiresReceiptValidation\)/);
  assert.match(endpoint, /reconcileAllowlistedLegacyPayment\(entry\)/);
  assert.doesNotMatch(endpoint, /body\?\.amount|body\?\.basis|body\?\.internalNote/);
});

test('admin review UI requires one explicit confirmation and has no bulk control', () => {
  assert.match(admin, /Confirmar reconciliación/);
  assert.match(admin, /window\.confirm/);
  assert.match(admin, /customer.*pedido.*adminMoney\(amountPYG\)/s);
  assert.match(admin, /ownerConfirmed: true/);
  assert.match(admin, /Casos especiales confirmados/);
  assert.match(admin, /data-legacy-review-receipt/);
  assert.doesNotMatch(admin, /Confirmar (?:todo|todos|todas)/i);
});

test('admin review cards use a dedicated vertical responsive layout and explanatory counts', () => {
  assert.match(admin, /<article class="legacy-review-card" data-legacy-review-card>/);
  assert.doesNotMatch(admin, /<article class="admin-order-row-v2" data-legacy-review-card>/);
  assert.match(admin, /class="legacy-review-identity"/);
  assert.match(admin, /class="legacy-review-details"/);
  assert.match(admin, /class="legacy-review-note"/);
  assert.match(admin, /class="legacy-review-actions"/);
  assert.match(admin, /\.legacy-review-card\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(admin, /\.legacy-review-order-id,[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s);
  assert.match(admin, /\.legacy-review-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
  assert.match(admin, /@media \(max-width: 860px\)[\s\S]*?\.legacy-review-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*1fr;/);
  assert.match(admin, /approvedCount = Number\(data\.approvedCount \|\| 0\)/);
  assert.match(admin, /reconciledCount = Math\.max\(approvedCount - remaining, 0\)/);
  assert.match(admin, /pendiente.*aprobado.*ya reconciliado/s);
});
