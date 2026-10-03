import {
  getOrder,
  receiptStore,
  recordOrderReceipt,
} from './commerce.mjs';
import { dispatchSellerNotificationsSafely } from './seller-notifications.mjs';

export const MAX_RECEIPT_SIZE = 3_000_000;

export const ALLOWED_RECEIPT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function uploadError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export async function attachOrderReceipt({ orderId, file, uploadedBy }) {
  if (!(file instanceof File)) throw uploadError('Seleccioná el comprobante.');
  if (!ALLOWED_RECEIPT_TYPES.has(file.type)) {
    throw uploadError('El comprobante debe ser JPEG, PNG, WebP o PDF.');
  }
  if (file.size <= 0 || file.size > MAX_RECEIPT_SIZE) {
    throw uploadError('El comprobante debe pesar menos de 3 MB.');
  }

  const receiptKey = `${orderId}/${crypto.randomUUID()}`;
  const uploadedAt = Date.now();
  const receipt = {
    storageKey: receiptKey,
    fileName: file.name,
    contentType: file.type,
    uploadedAt,
    uploadedBy,
  };

  await receiptStore().set(receiptKey, Buffer.from(await file.arrayBuffer()).toString('base64'), {
    metadata: {
      fileName: file.name,
      contentType: file.type,
      uploadedAt: String(uploadedAt),
      uploadedBy,
    },
  });

  try {
    if (!await recordOrderReceipt(orderId, receipt)) {
      throw uploadError('Este pedido ya no puede recibir otro comprobante.', 409);
    }
  } catch (error) {
    await receiptStore().delete(receiptKey).catch(() => {});
    throw error;
  }

  await dispatchSellerNotificationsSafely();

  return getOrder(orderId);
}
