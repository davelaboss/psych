import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin-auth';
import { listProductInventoryAudit } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ error: 'Acceso no autorizado.' }, { status: 403 });
    const { id } = await params;
    if (!/^real-[a-zA-Z0-9-]+$/.test(id)) return NextResponse.json({ error: 'Item no válido.' }, { status: 400 });
    return NextResponse.json({ entries: await listProductInventoryAudit(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo cargar el historial.' }, { status: 500 });
  }
}
