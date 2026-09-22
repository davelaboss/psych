import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getAuthorizedSeller } from '@/lib/admin-auth';
import { resolveBatchPhoto, saveBatchProductImage } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!await getAuthorizedSeller()) return NextResponse.json({ error: 'Acceso no autorizado.' }, { status: 403 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('No se recibió una foto.');
    const match = resolveBatchPhoto(file.name);
    if (!match) throw new Error(`“${file.name}” no pertenece al lote preparado.`);
    if (!['image/jpeg', 'image/jpg'].includes(file.type.toLowerCase())) throw new Error('Las fotos deben estar en formato JPEG.');
    if (file.size > 8_000_000) throw new Error('La foto supera el límite de 8 MB.');
    const objectKey = `private-inventory/${match.batchId}/${match.productId}/${match.sortOrder}.jpg`;
    const bucket = (env as unknown as { FILES?: R2Bucket }).FILES;
    if (!bucket) throw new Error('El almacenamiento privado de fotos no está disponible.');
    await bucket.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { originalFilename: match.expectedFilename, privacyStatus: 'CLEARED' },
    });
    await saveBatchProductImage({
      productId: match.productId,
      sortOrder: match.sortOrder,
      filename: match.expectedFilename,
      contentType: 'image/jpeg',
      objectKey,
    });
    return NextResponse.json({ ok: true, productId: match.productId, sortOrder: match.sortOrder });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo subir la foto.' }, { status: 400 });
  }
}
