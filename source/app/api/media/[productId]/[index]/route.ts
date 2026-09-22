import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { getProductImageRecord } from '@/lib/database';
import { realStorefrontEnabled } from '@/lib/launch';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ productId: string; index: string }> }) {
  const { productId, index } = await context.params;
  const sortOrder = Number(index);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) return new NextResponse('No encontrado', { status: 404 });
  const record = await getProductImageRecord(productId, sortOrder);
  if (!record) return new NextResponse('No encontrado', { status: 404 });
  const isPrivate = record.status === 'NEEDS_REVIEW' || record.status === 'UNLISTED' || (!record.isDemo && !realStorefrontEnabled());
  if (isPrivate && !await getAdminSession()) return new NextResponse('No autorizado', { status: 403 });
  const bucket = (env as unknown as { FILES?: R2Bucket }).FILES;
  if (!bucket) return new NextResponse('Almacenamiento no disponible', { status: 503 });
  const object = await bucket.get(record.objectKey);
  if (!object) return new NextResponse('No encontrado', { status: 404 });
  return new NextResponse(object.body, {
    headers: {
      'content-type': record.contentType,
      'cache-control': isPrivate ? 'private, no-store' : 'public, max-age=86400, stale-while-revalidate=604800',
      'x-content-type-options': 'nosniff',
    },
  });
}
