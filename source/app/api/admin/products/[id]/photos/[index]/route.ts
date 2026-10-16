import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { getProductImageRecord, replaceProductImageReference } from '@/lib/database';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function POST(request: Request, context: { params: Promise<{ id: string; index: string }> }) {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ error: 'Acceso no autorizado.' }, { status: 403 });
    const { id, index } = await context.params;
    const sortOrder = Number(index);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new Error('La posición de la foto no es válida.');
    if (!await getProductImageRecord(id, sortOrder)) throw new Error('La foto seleccionada no está disponible para reemplazo.');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('No se recibió una foto.');
    const contentType = file.type.toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) throw new Error('Usá una imagen JPEG, PNG o WebP.');
    if (file.size === 0) throw new Error('La imagen está vacía.');
    if (file.size > 8_000_000) throw new Error('La foto supera el límite de 8 MB.');
    const bucket = (env as unknown as { FILES?: R2Bucket }).FILES;
    if (!bucket) throw new Error('El almacenamiento privado de fotos no está disponible.');
    const objectKey = `private-inventory/replacements/${id}/${sortOrder}/${crypto.randomUUID()}.${EXTENSIONS[contentType]}`;
    await bucket.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType },
      customMetadata: { originalFilename: file.name, privacyStatus: 'CLEARED', replacement: 'true' },
    });
    const result = await replaceProductImageReference({
      productId: id, sortOrder, filename: file.name, contentType, objectKey,
    }, { role: session.role, email: session.user.email });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo reemplazar la foto.' }, { status: 400 });
  }
}
