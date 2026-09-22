import {
  getAuthorizedOrder,
  jsonResponse,
  lockInventoryHold,
  mutateOrder,
  publicOrder,
  receiptStore,
} from './_shared/commerce.mjs';


const MAX_FILE_SIZE =
  3_000_000;

const ALLOWED_TYPES =
  new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ]);


export default async function handler(request) {
  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  try {
    const form =
      await request.formData();

    const orderId =
      String(
        form.get('orderId') || ''
      ).trim();

    const accessToken =
      String(
        form.get('access') || ''
      ).trim();

    const file =
      form.get('file');

    const order =
      await getAuthorizedOrder(
        orderId,
        accessToken
      );

    if (!order) {
      return jsonResponse(
        {
          error:
            'No encontramos ese pedido o el enlace privado no es válido.',
        },
        404
      );
    }

    if (
      order.status !==
      'AWAITING_INITIAL_PAYMENT'
    ) {
      return jsonResponse(
        {
          error:
            'Este pedido ya tiene un comprobante registrado.',
        },
        409
      );
    }

    if (!(file instanceof File)) {
      throw new Error(
        'Seleccioná el comprobante.'
      );
    }

    if (
      !ALLOWED_TYPES.has(
        file.type
      )
    ) {
      throw new Error(
        'El comprobante debe ser JPEG, PNG, WebP o PDF.'
      );
    }

    if (
      file.size <= 0 ||
      file.size > MAX_FILE_SIZE
    ) {
      throw new Error(
        'El comprobante debe pesar menos de 3 MB.'
      );
    }

    const receiptKey =
      `${orderId}/${crypto.randomUUID()}`;

    const bytes =
      Buffer.from(
        await file.arrayBuffer()
      );

    await receiptStore().set(
      receiptKey,
      bytes.toString('base64'),
      {
        metadata: {
          fileName: file.name,
          contentType: file.type,
          uploadedAt:
            String(Date.now()),
        },
      }
    );

    const holdLocked =
      await lockInventoryHold(
        orderId
      );

    if (!holdLocked) {
      await receiptStore().delete(
        receiptKey
      );

      return jsonResponse(
        {
          error:
            'La reserva temporal venció antes de recibir el comprobante. Volvé al carrito para verificar disponibilidad.',
        },
        409
      );
    }

    const updatedOrder =
      await mutateOrder(
        orderId,
        (current) => ({
          ...current,

          status:
            'RECEIPT_RECEIVED',

          updatedAt:
            Date.now(),

          holdExpiresAt:
            null,

          receipt: {
            storageKey:
              receiptKey,

            fileName:
              file.name,

            contentType:
              file.type,

            uploadedAt:
              Date.now(),
          },
        })
      );

    return jsonResponse({
      ok: true,

      order:
        publicOrder(updatedOrder),
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el comprobante.',
      },
      400
    );
  }
}