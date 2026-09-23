import {
  adminAuthorized,
  getProductOverride,
  jsonResponse,
  productMediaStore,
  saveProductOverride,
} from './_shared/commerce.mjs';


function imageList(value) {
  return Array.isArray(value)
    ? value.map(String).filter(Boolean)
    : [];
}


function managedStorageKey(urlValue) {
  try {
    const url = new URL(
      String(urlValue || ''),
      'https://example.invalid'
    );

    if (
      url.pathname !==
      '/.netlify/functions/product-photo'
    ) {
      return null;
    }

    return url.searchParams.get('key');
  } catch {
    return null;
  }
}


async function removeManagedImage(urlValue) {
  const key =
    managedStorageKey(urlValue);

  if (key) {
    await productMediaStore().delete(key);
  }
}


export default async function handler(request) {
  if (!adminAuthorized(request)) {
    return jsonResponse(
      { error: 'Acceso no autorizado.' },
      401
    );
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Método no permitido.' },
      405
    );
  }

  try {
    const body = await request.json();

    const productId =
      String(body?.productId || '').trim();

    const action =
      String(body?.action || '').trim();

    if (!productId) {
      throw new Error(
        'Falta el artículo.'
      );
    }

    const current =
      await getProductOverride(productId) || {
        productId,
        publicFields: {},
        internalFields: {},
      };

    let images =
      Object.prototype.hasOwnProperty.call(
        current,
        'images'
      )
        ? imageList(current.images)
        : imageList(body.currentImages);

    if (
      action === 'add' ||
      action === 'replace'
    ) {
      const base64 =
        String(body?.base64 || '');

      if (!base64) {
        throw new Error(
          'La foto está vacía.'
        );
      }

      if (base64.length > 8_000_000) {
        throw new Error(
          'La foto es demasiado grande.'
        );
      }

      const storageKey =
        `${productId}/${crypto.randomUUID()}`;

      await productMediaStore().set(
        storageKey,
        base64,
        {
          metadata: {
            contentType:
              String(
                body?.contentType ||
                'image/jpeg'
              ),

            fileName:
              String(
                body?.fileName ||
                'foto.jpg'
              ),
          },
        }
      );

      const newUrl =
        `/.netlify/functions/product-photo?key=${encodeURIComponent(
          storageKey
        )}`;

      if (action === 'replace') {
        const target =
          String(body?.target || '');

        const index =
          images.indexOf(target);

        if (index < 0) {
          await productMediaStore().delete(
            storageKey
          );

          throw new Error(
            'No encontramos la foto a reemplazar.'
          );
        }

        await removeManagedImage(
          images[index]
        );

        images[index] = newUrl;
      } else {
        images.push(newUrl);
      }
    } else if (action === 'delete') {
      const target =
        String(body?.target || '');

      await removeManagedImage(target);

      images =
        images.filter(
          (image) => image !== target
        );
    } else if (action === 'primary') {
      const target =
        String(body?.target || '');

      const index =
        images.indexOf(target);

      if (index > 0) {
        images.splice(index, 1);
        images.unshift(target);
      }
    } else {
      throw new Error(
        'Acción de foto no válida.'
      );
    }

    const saved =
      await saveProductOverride(
        productId,
        {
          ...current,
          images,
        }
      );

    return jsonResponse({
      ok: true,
      images: saved.images || [],
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo actualizar la foto.',
      },
      400
    );
  }
}
