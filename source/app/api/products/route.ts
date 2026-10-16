import { NextRequest, NextResponse } from 'next/server';
import { getPublicProductsByIds, listPublicProducts } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const ids = request.nextUrl.searchParams.get('ids')?.split(',').filter(Boolean) ?? [];
    const products = ids.length ? await getPublicProductsByIds(ids) : await listPublicProducts();
    return NextResponse.json({ products });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo cargar el inventario.' }, { status: 500 });
  }
}
