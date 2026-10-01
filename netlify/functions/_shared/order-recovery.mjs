import { getStore } from '@netlify/blobs';
import { getOrderSnapshot, synchronizeOrderProjection } from './inventory-database.mjs';

export async function recoverOrderBlob(orderId) {
  const store = getStore({ name: 'mudanza-orders', consistency: 'strong' });
  return synchronizeOrderProjection(orderId, async (snapshot, version) => {
    const existing = await store.get(orderId, { type: 'json', consistency: 'strong' });
    if (existing?._inventoryVersion === version) return;
    // Unconditional projection writes are serialized by the checkout row lock.
    // The database snapshot remains authoritative even after an uncertain write.
    await store.setJSON(orderId, { ...existing, ...snapshot, _inventoryVersion: version });
  });
}

export async function readRecoverableOrder(orderId) {
  const snapshot = await getOrderSnapshot(orderId);
  if (!snapshot) return getStore({ name: 'mudanza-orders', consistency: 'strong' }).get(orderId, { type: 'json', consistency: 'strong' });
  try { await recoverOrderBlob(orderId); } catch { /* A read can still return the durable recovery snapshot. */ }
  // Read again so a concurrent receipt/payment update cannot be hidden by an old projection.
  return getOrderSnapshot(orderId);
}
